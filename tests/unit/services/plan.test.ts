import { describe, expect, it, vi } from 'vitest';

import { mockPlan, mockPlanDay } from '../../fixtures/plan';
import { prismaMock } from '../../mocks/prisma';

vi.mock('../../../prisma/index', () => ({ default: prismaMock }));

const {
    addPlanDay,
    addRecipesToPlanDay,
    createPlan,
    getPlan,
    removePlanDay,
    removeRecipeFromPlanDay,
} = await import('../../../src/services/plan');

describe('createPlan()', () => {
    it('creates plan and planDay atomically in a transaction', async () => {
        prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
        prismaMock.plan.create.mockResolvedValue(mockPlan);
        prismaMock.planDay.create.mockResolvedValue(mockPlanDay);

        const result = await createPlan(1);

        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
        expect(prismaMock.plan.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { household: { connect: { id: 1 } } },
            }),
        );
        expect(prismaMock.planDay.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ date: null }),
            }),
        );
        expect(result.id).toBe(mockPlan.id);
    });
});

describe('getPlan()', () => {
    it('returns plan with nested planDays and recipes', async () => {
        prismaMock.plan.findFirstOrThrow.mockResolvedValue(mockPlan as any);

        const result = await getPlan(1);

        expect(prismaMock.plan.findFirstOrThrow).toHaveBeenCalledWith(
            expect.objectContaining({
                include: expect.objectContaining({ planDays: expect.any(Object) }),
                where: { deletedAt: null, householdId: 1 },
            }),
        );
        expect(result.id).toBe(mockPlan.id);
    });

    it('throws if no plan exists', async () => {
        prismaMock.plan.findFirstOrThrow.mockRejectedValue(new Error('No plan'));

        await expect(getPlan(999)).rejects.toThrow('No plan');
    });
});

describe('addPlanDay()', () => {
    it('adds a new day to the plan', async () => {
        const updatedPlan = { ...mockPlan, planDays: [...mockPlan.planDays, mockPlanDay] };
        prismaMock.plan.update.mockResolvedValue(updatedPlan as any);

        const date = new Date('2024-07-01');
        await addPlanDay(1, { date, planId: 1 });

        expect(prismaMock.plan.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { planDays: { create: { date } } },
                where: { householdId: 1, id: 1 },
            }),
        );
    });
});

describe('removePlanDay()', () => {
    it("soft-deletes a plan day of the household's plan", async () => {
        prismaMock.planDay.updateMany.mockResolvedValue({ count: 1 });

        await removePlanDay(7, 1);

        expect(prismaMock.planDay.updateMany).toHaveBeenCalledWith({
            data: { deletedAt: expect.any(Date) },
            where: { deletedAt: null, id: 1, plan: { householdId: 7 } },
        });
    });

    it("throws not found for another household's plan day", async () => {
        prismaMock.planDay.updateMany.mockResolvedValue({ count: 0 });

        await expect(removePlanDay(7, 99)).rejects.toThrow('Plan day not found');
    });
});

describe('addRecipesToPlanDay()', () => {
    it("connects the household's recipes to its plan day", async () => {
        prismaMock.planDay.findFirst.mockResolvedValue({ id: 1 } as any);
        prismaMock.recipe.count.mockResolvedValue(2);
        prismaMock.planDay.update.mockResolvedValue(mockPlanDay as any);

        await addRecipesToPlanDay(7, { planDayId: 1, recipeIds: [10, 11, 10] });

        expect(prismaMock.planDay.findFirst).toHaveBeenCalledWith({
            select: { id: true },
            where: { deletedAt: null, id: 1, plan: { householdId: 7 } },
        });
        expect(prismaMock.recipe.count).toHaveBeenCalledWith({
            where: { deletedAt: null, householdId: 7, id: { in: [10, 11] } },
        });
        expect(prismaMock.planDay.update).toHaveBeenCalledWith({
            data: {
                recipes: {
                    connect: [{ id: 10 }, { id: 11 }, { id: 10 }],
                },
            },
            where: { id: 1 },
        });
    });

    it("refuses another household's plan day", async () => {
        prismaMock.planDay.findFirst.mockResolvedValue(null);

        await expect(addRecipesToPlanDay(7, { planDayId: 99, recipeIds: [10] })).rejects.toThrow(
            'Plan day not found',
        );
        expect(prismaMock.planDay.update).not.toHaveBeenCalled();
    });

    it("refuses another household's recipes", async () => {
        prismaMock.planDay.findFirst.mockResolvedValue({ id: 1 } as any);
        prismaMock.recipe.count.mockResolvedValue(1);

        await expect(addRecipesToPlanDay(7, { planDayId: 1, recipeIds: [10, 99] })).rejects.toThrow(
            'Recipe not found',
        );
        expect(prismaMock.planDay.update).not.toHaveBeenCalled();
    });
});

describe('removeRecipeFromPlanDay()', () => {
    it("disconnects the recipe from the household's plan day", async () => {
        prismaMock.planDay.findFirst.mockResolvedValue({ id: 1 } as any);
        prismaMock.planDay.update.mockResolvedValue(mockPlanDay as any);

        await removeRecipeFromPlanDay(7, { planDayId: 1, recipeId: 42 });

        expect(prismaMock.planDay.update).toHaveBeenCalledWith({
            data: { recipes: { disconnect: { id: 42 } } },
            where: { id: 1 },
        });
    });

    it("refuses another household's plan day", async () => {
        prismaMock.planDay.findFirst.mockResolvedValue(null);

        await expect(removeRecipeFromPlanDay(7, { planDayId: 99, recipeId: 42 })).rejects.toThrow(
            'Plan day not found',
        );
        expect(prismaMock.planDay.update).not.toHaveBeenCalled();
    });
});
