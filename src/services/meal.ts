// Planned meals that aren't recipes (sous-web#67): a name and the pantry items it
// needs. Kept after they're made or taken off the plan, so the client can offer
// them again; deleting one dismisses it.
import { Prisma } from '@prisma/client';

import prisma from '../../prisma';
import { NotFoundError } from '../middleware/errors';
import { applyPantryUsage, type PantryUsage } from './pantry-usage';

/** A meal's live items with their pantry item, in the order they were added. */
export const mealInclude = {
    items: {
        include: { pantryItem: { include: { category: true } } },
        orderBy: { id: 'asc' },
        where: { pantryItem: { deletedAt: null } },
    },
} satisfies Prisma.MealInclude;

export interface MealUpsert {
    id?: number;
    items: { optional?: boolean; pantryItemId: number }[];
    name: string;
}

export type MealWithItems = Prisma.MealGetPayload<{ include: typeof mealInclude }>;

/** Marks a meal made: updates the pantry, removes it from the plan, keeps the meal. */
export async function completeMeal(
    householdId: number,
    mealId: number,
    usage: PantryUsage,
): Promise<void> {
    await prisma.$transaction(async (tx) => {
        await requireMeal(householdId, mealId, tx);
        await applyPantryUsage(tx, householdId, usage);
        await tx.meal.update({
            data: { lastMade: new Date(), planDays: { set: [] } },
            where: { id: mealId },
        });
    });
}

/** Dismisses a meal: it leaves the plan and is no longer offered. */
export async function deleteMeal(householdId: number, mealId: number): Promise<void> {
    await requireMeal(householdId, mealId);
    await prisma.meal.update({
        data: { deletedAt: new Date(), planDays: { set: [] } },
        where: { id: mealId },
    });
}

/** The household's meals, most recently changed or made first. */
export async function listMeals(householdId: number): Promise<MealWithItems[]> {
    return prisma.meal.findMany({
        include: mealInclude,
        orderBy: { updatedAt: 'desc' },
        where: { deletedAt: null, householdId },
    });
}

/** A live meal of this household, or NotFoundError. */
export async function requireMeal(
    householdId: number,
    mealId: number,
    tx: Prisma.TransactionClient = prisma,
): Promise<void> {
    const meal = await tx.meal.findFirst({
        select: { id: true },
        where: { deletedAt: null, householdId, id: mealId },
    });
    if (!meal) throw new NotFoundError('Meal not found');
}

/** Creates a meal, or replaces an existing one's name and items. */
export async function upsertMeal(householdId: number, meal: MealUpsert): Promise<MealWithItems> {
    // One row per pantry item; a repeat keeps the last flag given.
    const items = [...new Map(meal.items.map((i) => [i.pantryItemId, !!i.optional])).entries()];
    const pantryItemIds = items.map(([id]) => id);
    // Only this household's live pantry items.
    const owned = await prisma.pantryItem.count({
        where: { deletedAt: null, id: { in: pantryItemIds }, pantry: { householdId } },
    });
    if (owned !== pantryItemIds.length) throw new NotFoundError('Pantry item not found');

    return prisma.$transaction(async (tx) => {
        let id = meal.id;
        if (id == null) {
            id = (await tx.meal.create({ data: { householdId, name: meal.name } })).id;
        } else {
            await requireMeal(householdId, id, tx);
            await tx.meal.update({ data: { name: meal.name }, where: { id } });
            await tx.mealItem.deleteMany({ where: { mealId: id } });
        }
        if (items.length > 0) {
            await tx.mealItem.createMany({
                data: items.map(([pantryItemId, optional]) => ({
                    mealId: id,
                    optional,
                    pantryItemId,
                })),
            });
        }
        return tx.meal.findUniqueOrThrow({ include: mealInclude, where: { id } });
    });
}
