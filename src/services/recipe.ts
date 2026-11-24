import { Prisma, Recipe } from '@prisma/client';

import prisma from '../../prisma';
import { SSEMessageType } from '../../utils/constants';
import { broadcast } from '../../utils/sse';
import { parseIngredients } from './ingredient';
import { applyPantryUsage } from './pantry-usage';
import { scrapeRecipe } from './scraper';

/** An ingredient line as sent by a client: plain text, or with its optional flag. */
type IngredientInput = string | { optional?: boolean; sentence: string };

type RecipeCompletion = {
    finishedPantryItems?: number[];
    lowPantryItems?: number[];
    note?: string;
    rating?: number;
    recipeId: number;
};

type RecipeUpsert = {
    cookTime?: null | string;
    id?: number;
    ingredients?: IngredientInput[];
    instructions?: null | string[];
    name?: string;
    notes?: null | string;
    prepTime?: null | string;
    servings?: null | string;
    source?: null | string;
    tags?: { id?: number; name: string }[];
};

type RecipeWithJoins = Prisma.RecipeGetPayload<{
    include: {
        ingredients: true;
        tags: true;
    };
}>;

export async function completeRecipe(
    householdId: number,
    completion: RecipeCompletion,
): Promise<void> {
    await prisma.$transaction(async (tx) => {
        const recipe = await tx.recipe.findFirstOrThrow({
            where: { householdId, id: completion.recipeId },
        });

        await tx.recipe.update({
            data: {
                lastMade: new Date(),
                ...(completion.note && { notes: appendNote(recipe.notes, completion.note) }),
                rating: completion.rating || recipe.rating,
                timesMade: { increment: 1 },
            },
            where: { id: completion.recipeId },
        });

        await applyPantryUsage(tx, householdId, completion);

        const planned = await tx.planDay.findMany({
            select: { id: true },
            where: {
                plan: { householdId },
                recipes: { some: { id: completion.recipeId } },
            },
        });

        for (const pd of planned) {
            await tx.planDay.update({
                data: {
                    recipes: {
                        disconnect: { id: completion.recipeId },
                    },
                },
                where: { id: pd.id },
            });
        }
    });
}

export async function createRecipeFromUrl(
    householdId: number,
    url: string,
): Promise<RecipeWithJoins> {
    const recipeData = await scrapeRecipe(url);

    if (!recipeData) {
        throw new Error('Failed to scrape recipe from URL');
    }

    const optional = new Set(recipeData.optionalIngredients);
    const recipe: RecipeUpsert = {
        cookTime: recipeData.cookTime,
        ingredients: recipeData.ingredients.map((sentence, i) =>
            // An "Optional:" section marks its lines; other lines go by their text.
            optional.has(i) ? { optional: true, sentence } : sentence,
        ),
        instructions: recipeData.instructions,
        name: recipeData.name || 'Untitled Recipe',
        notes: recipeData.notes,
        prepTime: recipeData.prepTime,
        servings: recipeData.servings,
        source: url,
    };

    return upsertRecipe(householdId, recipe);
}

export async function deleteRecipe(householdId: number, id: number): Promise<void> {
    await broadcast<void>(householdId, SSEMessageType.RECIPE_DELETE, 'deleteRecipe', async () => {
        await prisma.recipe.update({
            data: { deletedAt: new Date() },
            where: { householdId, id },
        });
    });
}

export async function getAllRecipes(
    householdId: number,
    { limit = 50, page = 1 }: { limit?: number; page?: number } = {},
): Promise<RecipeWithJoins[]> {
    return prisma.recipe.findMany({
        include: {
            ingredients: { orderBy: { id: 'asc' } },
            tags: { orderBy: { id: 'asc' } },
        },
        orderBy: { id: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        where: { deletedAt: null, householdId },
    });
}

export async function getAllRecipeTags(householdId: number) {
    return prisma.recipeTag.findMany({
        orderBy: { name: 'asc' },
        where: { householdId },
    });
}

export async function getRecipe(householdId: number, id: number): Promise<RecipeWithJoins> {
    return prisma.recipe.findUniqueOrThrow({
        include: {
            ingredients: { orderBy: { id: 'asc' } },
            tags: { orderBy: { id: 'asc' } },
        },
        where: { householdId, id },
    });
}

export async function upsertRecipe(
    householdId: number,
    patch: RecipeUpsert,
): Promise<RecipeWithJoins> {
    return await broadcast<RecipeWithJoins>(
        householdId,
        SSEMessageType.RECIPE_UPDATE,
        'upsertRecipe',
        async () => {
            const { id, ingredients, tags, ...data } = patch;
            // Resolve tags to this household's tag ids first, then attach them with
            // `connect`/`set`. A nested write that mixes `set: []` with
            // `connectOrCreate` doesn't work: Prisma applies the `set` last, which
            // left every edited recipe with no tags.
            const tagIds = tags ? await upsertTags(householdId, tags) : undefined;
            let updatedRecipe;

            if (!id) {
                updatedRecipe = await prisma.recipe.create({
                    data: {
                        ...(data as Prisma.RecipeUncheckedCreateInput),
                        householdId,
                        ...(tagIds && { tags: { connect: tagIds } }),
                    },
                });
            } else {
                updatedRecipe = await prisma.recipe.update({
                    data: {
                        ...(data as Prisma.RecipeUpdateInput),
                        // Omitted `tags` leaves them unchanged; an empty list clears them.
                        ...(tagIds && { tags: { set: tagIds } }),
                    },
                    where: { householdId, id },
                });
            }

            return processIngredients(updatedRecipe, ingredients);
        },
    );
}

/** Adds a line to the end of a recipe's notes, on its own line. */
export const appendNote = (notes: null | string, line: string): string => {
    const existing = (notes ?? '').trimEnd();
    return existing ? `${existing}\n${line}` : line;
};

/** Finds or creates each named tag in the household and returns their ids. */
const upsertTags = async (householdId: number, tags: { name: string }[]) => {
    const names = [...new Set(tags.map((tag) => tag.name))];
    const rows = await prisma.$transaction(
        names.map((name) =>
            prisma.recipeTag.upsert({
                create: { householdId, name },
                update: {},
                where: { householdId_name: { householdId, name } },
            }),
        ),
    );

    return rows.map(({ id }) => ({ id }));
};

/** Whether an ingredient line says it's optional ("parsley, optional"). */
export const mentionsOptional = (sentence: string): boolean => /\boptional\b/i.test(sentence);

/** A client's ingredient line as a row: plain lines are optional when they say so. */
export const toIngredientRow = (input: IngredientInput) =>
    typeof input === 'string'
        ? { optional: mentionsOptional(input), sentence: input }
        : {
              optional: input.optional ?? mentionsOptional(input.sentence),
              sentence: input.sentence,
          };

const processIngredients = async (recipe: Recipe, ingredients?: IngredientInput[]) => {
    if (ingredients && ingredients.length > 0) {
        await prisma.$transaction([
            prisma.ingredient.deleteMany({
                where: { recipeId: recipe.id },
            }),
            prisma.ingredient.createManyAndReturn({
                data: ingredients.map((input) => ({
                    recipeId: recipe.id,
                    ...toIngredientRow(input),
                })),
            }),
        ]);
    }

    return parseIngredients(recipe.id);
};
