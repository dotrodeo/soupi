import { describe, expect, it, vi } from 'vitest';

import { mockCategory, mockCategory2 } from '../../fixtures/category';
import { mockPantry } from '../../fixtures/pantry';
import { prismaMock } from '../../mocks/prisma';

vi.mock('../../../prisma/index', () => ({ default: prismaMock }));
vi.mock('../../../utils/sse', () => ({
    addClient: vi.fn(),
    broadcast: vi.fn(
        async (_hid: number, _type: unknown, _from: string, cb: () => Promise<unknown>) => cb(),
    ),
}));

const { deleteCategory, getCategories, getCategory, updateSortOrder, upsertCategory } =
    await import('../../../src/services/category');

describe('getCategories()', () => {
    it('returns categories sorted by sortOrder', async () => {
        prismaMock.itemCategory.findMany.mockResolvedValue([mockCategory, mockCategory2]);

        const result = await getCategories(1, 1);

        expect(prismaMock.itemCategory.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy: { sortOrder: 'asc' },
                where: { deletedAt: null, pantry: { householdId: 1 }, pantryId: 1 },
            }),
        );
        expect(result).toHaveLength(2);
    });
});

describe('upsertCategory()', () => {
    it('creates a new category when none exists', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.itemCategory.findFirst.mockResolvedValue(null);
        prismaMock.itemCategory.create.mockResolvedValue(mockCategory);

        const result = await upsertCategory(1, 1, { icon: '🥦', name: 'Produce' });

        expect(prismaMock.itemCategory.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ name: 'Produce', pantryId: 1 }),
            }),
        );
        expect(result.name).toBe('Produce');
    });

    it('updates existing category when found', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.itemCategory.findFirst.mockResolvedValue(mockCategory);
        prismaMock.itemCategory.update.mockResolvedValue({ ...mockCategory, name: 'Vegetables' });

        await upsertCategory(1, 1, { name: 'Vegetables' });

        expect(prismaMock.itemCategory.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: mockCategory.id } }),
        );
    });

    it('throws when pantry not found', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockRejectedValue(new Error('Not found'));

        await expect(upsertCategory(99, 99, { name: 'X' })).rejects.toThrow('Not found');
    });

    it('adding by name ignores deleted categories', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.itemCategory.findFirst.mockResolvedValue(null);
        prismaMock.itemCategory.create.mockResolvedValue(mockCategory);

        await upsertCategory(1, 1, { name: 'Snacks' });

        expect(prismaMock.itemCategory.findFirst).toHaveBeenCalledWith({
            where: { deletedAt: null, name: 'Snacks', pantryId: 1 },
        });
        expect(prismaMock.itemCategory.create).toHaveBeenCalled();
    });

    it('editing by id matches only a live category in this pantry', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.itemCategory.findFirst.mockResolvedValue(mockCategory);
        prismaMock.itemCategory.update.mockResolvedValue(mockCategory);

        await upsertCategory(1, 1, { id: 5, name: 'Produce' });

        expect(prismaMock.itemCategory.findFirst).toHaveBeenCalledWith({
            where: { deletedAt: null, id: 5, pantryId: 1 },
        });
    });

    it('editing an unknown id throws instead of creating', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.itemCategory.findFirst.mockResolvedValue(null);

        await expect(upsertCategory(1, 1, { id: 404, name: 'X' })).rejects.toThrow(
            'Category not found',
        );
        expect(prismaMock.itemCategory.create).not.toHaveBeenCalled();
    });
});

describe('deleteCategory()', () => {
    it('soft-deletes the category and uncategorizes its items', async () => {
        prismaMock.itemCategory.updateMany.mockResolvedValue({ count: 1 });
        prismaMock.pantryItem.updateMany.mockResolvedValue({ count: 3 });

        expect(await deleteCategory(1, 2, 5)).toBe(true);

        expect(prismaMock.itemCategory.updateMany).toHaveBeenCalledWith({
            data: { deletedAt: expect.any(Date) },
            where: { deletedAt: null, id: 5, pantry: { householdId: 1 }, pantryId: 2 },
        });
        expect(prismaMock.pantryItem.updateMany).toHaveBeenCalledWith({
            data: { categoryId: null },
            where: { categoryId: 5, pantryId: 2 },
        });
    });

    it('returns false and touches no items when the category is not in the household', async () => {
        prismaMock.itemCategory.updateMany.mockResolvedValue({ count: 0 });

        expect(await deleteCategory(1, 2, 999)).toBe(false);
        expect(prismaMock.pantryItem.updateMany).not.toHaveBeenCalled();
    });
});

describe('updateSortOrder()', () => {
    it('batches all updates in a single transaction', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.$transaction.mockResolvedValue([]);

        await updateSortOrder(1, 1, [3, 1, 2]);

        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
        // The transaction receives an array of 3 prisma operations
        const txArg = (prismaMock.$transaction as any).mock.calls[0][0];
        expect(Array.isArray(txArg)).toBe(true);
        expect(txArg).toHaveLength(3);
    });

    it('passes correct sort indices to each updateMany', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.itemCategory.updateMany.mockResolvedValue({ count: 1 });
        prismaMock.$transaction.mockImplementation(async (ops: any) => {
            // Execute each operation to verify arguments
            return Promise.all(ops);
        });

        await updateSortOrder(1, 1, [10, 20, 30]);

        expect(prismaMock.itemCategory.updateMany).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ data: { sortOrder: 0 }, where: { id: 10, pantryId: 1 } }),
        );
        expect(prismaMock.itemCategory.updateMany).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ data: { sortOrder: 1 }, where: { id: 20, pantryId: 1 } }),
        );
        expect(prismaMock.itemCategory.updateMany).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({ data: { sortOrder: 2 }, where: { id: 30, pantryId: 1 } }),
        );
    });

    it('does nothing with an empty array', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.$transaction.mockResolvedValue([]);

        await updateSortOrder(1, 1, []);

        const txArg = (prismaMock.$transaction as any).mock.calls[0][0];
        expect(txArg).toHaveLength(0);
    });
});

describe('getCategory()', () => {
    it('returns a category by pantryId and categoryId', async () => {
        prismaMock.itemCategory.findFirstOrThrow.mockResolvedValue(mockCategory);

        const result = await getCategory(1, 1, 1);

        expect(prismaMock.itemCategory.findFirstOrThrow).toHaveBeenCalledWith({
            where: { deletedAt: null, id: 1, pantry: { householdId: 1 }, pantryId: 1 },
        });
        expect(result).toEqual(mockCategory);
    });

    it('throws when category is not found', async () => {
        prismaMock.itemCategory.findFirstOrThrow.mockRejectedValue(new Error('Not found'));

        await expect(getCategory(1, 1, 999)).rejects.toThrow('Not found');
    });
});
