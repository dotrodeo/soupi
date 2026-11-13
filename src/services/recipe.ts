import { Prisma, Recipe } from '@prisma/client';

import prisma from '../../prisma';
import { SSEMessageType } from '../../utils/constants';
import { broadcast } from '../../utils/sse';
import { parseIngredients } from './ingredient';
import { scrapeRecipe } from './scraper';

type RecipeCompletion = {
    finishedPantryItems?: number[];
    rating?: number;
    recipeId: number;
};

type RecipeUpsert = {
    cookTime?: null | string;
    id?: number;
    ingredients?: string[];
    instructions?: null | string[];
    name?: string;
    prepTime?: null | string;
    servings?: null | string;
    source?: null | string;
    tags?: { id: number; name: string }[];
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
                rating: completion.rating || recipe.rating,
                timesMade: { increment: 1 },
            },
            where: { id: completion.recipeId },
        });

        const items = await tx.pantryItem.findMany({
            select: { id: true, isFavorite: true },
            where: { id: { in: completion.finishedPantryItems } },
        });

        for (const item of items) {
            await tx.pantryItem.update({
                data: {
                    isInShoppingList: item.isFavorite ? true : false,
                    isInStock: false,
                },
                where: { id: item.id },
            });
        }

        const planned = await tx.planDay.findMany({
            select: { id: true },
            where: {
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

    const recipe: RecipeUpsert = {
        cookTime: parseTimes(recipeData.cookTime),
        ingredients: recipeData.ingredients,
        instructions: recipeData.instructions,
        name: recipeData.name || 'Untitled Recipe',
        prepTime: parseTimes(recipeData.prepTime),
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

const processIngredients = async (recipe: Recipe, ingredients?: string[]) => {
    if (ingredients && ingredients.length > 0) {
        await prisma.$transaction([
            prisma.ingredient.deleteMany({
                where: { recipeId: recipe.id },
            }),
            prisma.ingredient.createManyAndReturn({
                data: ingredients.map((sentence: string) => ({
                    recipeId: recipe.id,
                    sentence,
                })),
            }),
        ]);
    }

    return parseIngredients(recipe.id);
};

const parseTimes = (time?: null | string | undefined) => {
    if (!time) return time;

    if (time.match(/PT\d+\w+/)) {
        const [, minutes, flag] = /(\d+)(\w+)/.exec(time) || [];
        let parsed = '';

        if (flag === 'M') {
            const mins = Number(minutes);
            const hours = Math.floor(mins / 60);
            const remMinutes = mins % 60;

            if (hours > 0) {
                parsed += `${hours} hour${hours > 1 ? 's ' : ' '}`;
            }
            if (remMinutes > 0) {
                parsed += `${remMinutes} min${remMinutes > 1 ? 's' : ''}`;
            }

            return parsed.trim();
        }
    }

    return time;
};
