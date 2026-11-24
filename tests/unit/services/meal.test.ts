import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prismaMock } from '../../mocks/prisma';

vi.mock('../../../prisma/index', () => ({ default: prismaMock }));

const { completeMeal, deleteMeal, listMeals, upsertMeal } = await import(
    '../../../src/services/meal'
);
const { addMealsToPlanDay, removeMealFromPlanDay } = await import('../../../src/services/plan');

const T = new Date('2026-11-23T12:00:00Z');
const meal = {
    createdAt: T,
    deletedAt: null,
    householdId: 1,
    id: 5,
    lastMade: null,
    name: 'tacos',
    updatedAt: T,
};

beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
});

describe('listMeals()', () => {
    it("lists the household's live meals, newest first, without deleted pantry items", async () => {
        prismaMock.meal.findMany.mockResolvedValue([meal] as never);

        await listMeals(1);

        expect(prismaMock.meal.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                include: {
                    items: expect.objectContaining({ where: { pantryItem: { deletedAt: null } } }),
                },
                orderBy: { updatedAt: 'desc' },
                where: { deletedAt: null, householdId: 1 },
            }),
        );
    });
});

describe('upsertMeal()', () => {
    it('creates a meal with its items, one row per pantry item', async () => {
        prismaMock.pantryItem.count.mockResolvedValue(2);
        prismaMock.meal.create.mockResolvedValue(meal as never);
        prismaMock.meal.findUniqueOrThrow.mockResolvedValue(meal as never);

        await upsertMeal(1, {
            items: [
                { pantryItemId: 10 },
                { optional: true, pantryItemId: 11 },
                { optional: false, pantryItemId: 10 },
            ],
            name: 'tacos',
        });

        expect(prismaMock.pantryItem.count).toHaveBeenCalledWith({
            where: { deletedAt: null, id: { in: [10, 11] }, pantry: { householdId: 1 } },
        });
        expect(prismaMock.meal.create).toHaveBeenCalledWith({
            data: { householdId: 1, name: 'tacos' },
        });
        expect(prismaMock.mealItem.createMany).toHaveBeenCalledWith({
            data: [
                { mealId: 5, optional: false, pantryItemId: 10 },
                { mealId: 5, optional: true, pantryItemId: 11 },
            ],
        });
    });

    it("refuses another household's pantry items", async () => {
        prismaMock.pantryItem.count.mockResolvedValue(1);

        await expect(
            upsertMeal(1, { items: [{ pantryItemId: 10 }, { pantryItemId: 99 }], name: 'tacos' }),
        ).rejects.toThrow('Pantry item not found');
        expect(prismaMock.meal.create).not.toHaveBeenCalled();
    });

    it('replaces the name and items of an existing meal', async () => {
        prismaMock.pantryItem.count.mockResolvedValue(1);
        prismaMock.meal.findFirst.mockResolvedValue({ id: 5 } as never);
        prismaMock.meal.findUniqueOrThrow.mockResolvedValue(meal as never);

        await upsertMeal(1, { id: 5, items: [{ pantryItemId: 12 }], name: 'fish tacos' });

        expect(prismaMock.meal.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { deletedAt: null, householdId: 1, id: 5 } }),
        );
        expect(prismaMock.meal.update).toHaveBeenCalledWith({
            data: { name: 'fish tacos' },
            where: { id: 5 },
        });
        expect(prismaMock.mealItem.deleteMany).toHaveBeenCalledWith({ where: { mealId: 5 } });
        expect(prismaMock.mealItem.createMany).toHaveBeenCalledWith({
            data: [{ mealId: 5, optional: false, pantryItemId: 12 }],
        });
    });

    it("refuses another household's meal", async () => {
        prismaMock.pantryItem.count.mockResolvedValue(0);
        prismaMock.meal.findFirst.mockResolvedValue(null);

        await expect(upsertMeal(1, { id: 77, items: [], name: 'x' })).rejects.toThrow(
            'Meal not found',
        );
        expect(prismaMock.meal.update).not.toHaveBeenCalled();
    });
});

describe('completeMeal()', () => {
    it('updates the pantry, takes the meal off the plan and keeps it', async () => {
        prismaMock.meal.findFirst.mockResolvedValue({ id: 5 } as never);
        prismaMock.pantryItem.findMany.mockResolvedValue([{ id: 10, isFavorite: true }] as never);

        await completeMeal(1, 5, { finishedPantryItems: [10], lowPantryItems: [11, 10] });

        expect(prismaMock.pantryItem.update).toHaveBeenCalledWith({
            data: { isInShoppingList: true, isInStock: false, isLow: false },
            where: { id: 10 },
        });
        expect(prismaMock.pantryItem.updateMany).toHaveBeenCalledWith({
            data: { isInStock: true, isLow: true },
            where: { id: { in: [11] }, pantry: { householdId: 1 } },
        });
        expect(prismaMock.meal.update).toHaveBeenCalledWith({
            data: { lastMade: expect.any(Date), planDays: { set: [] } },
            where: { id: 5 },
        });
    });

    it("refuses another household's meal", async () => {
        prismaMock.meal.findFirst.mockResolvedValue(null);
        await expect(completeMeal(1, 77, {})).rejects.toThrow('Meal not found');
        expect(prismaMock.pantryItem.update).not.toHaveBeenCalled();
    });
});

describe('deleteMeal()', () => {
    it('dismisses the meal and takes it off the plan', async () => {
        prismaMock.meal.findFirst.mockResolvedValue({ id: 5 } as never);

        await deleteMeal(1, 5);

        expect(prismaMock.meal.update).toHaveBeenCalledWith({
            data: { deletedAt: expect.any(Date), planDays: { set: [] } },
            where: { id: 5 },
        });
    });
});

describe('plan days and meals', () => {
    it("adds this household's meals to a plan day", async () => {
        prismaMock.planDay.findFirst.mockResolvedValue({ id: 3 } as never);
        prismaMock.meal.count.mockResolvedValue(1);

        await addMealsToPlanDay(1, { mealIds: [5, 5], planDayId: 3 });

        expect(prismaMock.meal.count).toHaveBeenCalledWith({
            where: { deletedAt: null, householdId: 1, id: { in: [5] } },
        });
        expect(prismaMock.planDay.update).toHaveBeenCalledWith({
            data: { meals: { connect: [{ id: 5 }] } },
            where: { id: 3 },
        });
    });

    it("refuses another household's meal on a plan day", async () => {
        prismaMock.planDay.findFirst.mockResolvedValue({ id: 3 } as never);
        prismaMock.meal.count.mockResolvedValue(0);

        await expect(addMealsToPlanDay(1, { mealIds: [77], planDayId: 3 })).rejects.toThrow(
            'Meal not found',
        );
        expect(prismaMock.planDay.update).not.toHaveBeenCalled();
    });

    it('takes a meal off a plan day', async () => {
        prismaMock.planDay.findFirst.mockResolvedValue({ id: 3 } as never);
        prismaMock.meal.findFirst.mockResolvedValue({ id: 5 } as never);

        await removeMealFromPlanDay(1, { mealId: 5, planDayId: 3 });

        expect(prismaMock.planDay.update).toHaveBeenCalledWith({
            data: { meals: { disconnect: { id: 5 } } },
            where: { id: 3 },
        });
    });
});
