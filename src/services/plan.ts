import { Plan } from '@prisma/client';

import prisma from '../../prisma';
import { NotFoundError } from '../middleware/errors';
import { mealInclude, requireMeal } from './meal';

export async function addMealsToPlanDay(
    householdId: number,
    { mealIds, planDayId }: { mealIds: number[]; planDayId: number },
): Promise<void> {
    await requirePlanDay(householdId, planDayId);
    // Only this household's live meals.
    const unique = [...new Set(mealIds)];
    const owned = await prisma.meal.count({
        where: { deletedAt: null, householdId, id: { in: unique } },
    });
    if (owned !== unique.length) throw new NotFoundError('Meal not found');

    await prisma.planDay.update({
        data: { meals: { connect: unique.map((id) => ({ id })) } },
        where: { id: planDayId },
    });
}

export async function addPlanDay(
    householdId: number,
    {
        date,
        planId,
    }: {
        date: Date;
        planId: number;
    },
): Promise<Plan> {
    return prisma.plan.update({
        data: {
            planDays: {
                create: {
                    date,
                },
            },
        },
        include: {
            planDays: {
                include: {
                    meals: { include: mealInclude, where: { deletedAt: null } },
                    recipes: true,
                },
                where: { deletedAt: null },
            },
        },
        where: { householdId, id: planId },
    });
}

export async function addRecipesToPlanDay(
    householdId: number,
    {
        planDayId,
        recipeIds,
    }: {
        planDayId: number;
        recipeIds: number[];
    },
): Promise<void> {
    await requirePlanDay(householdId, planDayId);
    // Only this household's recipes; another household's would be readable
    // through GET /plan once connected.
    const unique = [...new Set(recipeIds)];
    const owned = await prisma.recipe.count({
        where: { deletedAt: null, householdId, id: { in: unique } },
    });
    if (owned !== unique.length) throw new NotFoundError('Recipe not found');

    await prisma.planDay.update({
        data: {
            recipes: {
                connect: recipeIds.map((id) => ({ id })),
            },
        },
        where: { id: planDayId },
    });
}

export async function createPlan(householdId: number): Promise<Plan> {
    return prisma.$transaction(async (tx) => {
        const plan = await tx.plan.create({
            data: {
                household: { connect: { id: householdId } },
            },
        });

        await tx.planDay.create({
            data: {
                // Create a plan day with an explicit null date
                // This is the "upcoming" plan day
                date: null,
                plan: {
                    connect: { id: plan.id },
                },
            },
        });

        return plan;
    });
}

export async function getPlan(householdId: number): Promise<Plan> {
    return prisma.plan.findFirstOrThrow({
        include: {
            planDays: {
                include: {
                    meals: { include: mealInclude, where: { deletedAt: null } },
                    recipes: {
                        include: {
                            ingredients: true,
                        },
                    },
                },
                where: { deletedAt: null },
            },
        },
        where: {
            deletedAt: null,
            householdId,
        },
    });
}

export async function removeMealFromPlanDay(
    householdId: number,
    { mealId, planDayId }: { mealId: number; planDayId: number },
): Promise<void> {
    await requirePlanDay(householdId, planDayId);
    await requireMeal(householdId, mealId);
    await prisma.planDay.update({
        data: { meals: { disconnect: { id: mealId } } },
        where: { id: planDayId },
    });
}

export async function removePlanDay(householdId: number, planDayId: number): Promise<void> {
    const { count } = await prisma.planDay.updateMany({
        data: {
            deletedAt: new Date(),
        },
        where: { deletedAt: null, id: planDayId, plan: { householdId } },
    });
    if (!count) throw new NotFoundError('Plan day not found');
}

export async function removeRecipeFromPlanDay(
    householdId: number,
    {
        planDayId,
        recipeId,
    }: {
        planDayId: number;
        recipeId: number;
    },
): Promise<void> {
    await requirePlanDay(householdId, planDayId);
    await prisma.planDay.update({
        data: {
            recipes: {
                disconnect: { id: recipeId },
            },
        },
        where: { id: planDayId },
    });
}

/** A live plan day of this household's plan, or NotFoundError. */
async function requirePlanDay(householdId: number, planDayId: number) {
    const day = await prisma.planDay.findFirst({
        select: { id: true },
        where: { deletedAt: null, id: planDayId, plan: { householdId } },
    });
    if (!day) throw new NotFoundError('Plan day not found');
}
