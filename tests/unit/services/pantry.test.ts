import { describe, expect, it, vi } from 'vitest';

import { mockPantry, mockPantryItem } from '../../fixtures/pantry';
import { prismaMock } from '../../mocks/prisma';

vi.mock('../../../prisma/index', () => ({ default: prismaMock }));
vi.mock('../../../utils/sse', () => ({
    addClient: vi.fn(),
    broadcast: vi.fn(
        async (_hid: number, _type: unknown, _from: string, cb: () => Promise<unknown>) => cb(),
    ),
}));

const { deletePantryItem, getAllPantryItems, getPantries, getPantryItem, upsertPantryItem } =
    await import('../../../src/services/pantry');

describe('getPantries()', () => {
    it('returns the first pantry for the household', async () => {
        prismaMock.pantry.findFirstOrThrow.mockResolvedValue(mockPantry as any);

        const result = await getPantries(1);

        expect(prismaMock.pantry.findFirstOrThrow).toHaveBeenCalledWith(
            expect.objectContaining({
                include: expect.objectContaining({
                    itemCategories: expect.objectContaining({ where: { deletedAt: null } }),
                }),
                where: { householdId: 1 },
            }),
        );
        expect(result.id).toBe(1);
    });

    it('throws if no pantry exists', async () => {
        prismaMock.pantry.findFirstOrThrow.mockRejectedValue(new Error('No pantry'));

        await expect(getPantries(99)).rejects.toThrow('No pantry');
    });
});

describe('getAllPantryItems()', () => {
    it('returns items for the pantry filtered by household', async () => {
        prismaMock.pantryItem.findMany.mockResolvedValue([mockPantryItem]);

        const items = await getAllPantryItems(1, 1);

        expect(prismaMock.pantryItem.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { deletedAt: null, pantry: { householdId: 1 }, pantryId: 1 },
            }),
        );
        expect(items).toHaveLength(1);
    });
});

describe('upsertPantryItem()', () => {
    const baseItem = { name: 'Eggs', pantryId: 1 };

    it('creates a new item when none exists', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.pantryItem.findFirst.mockResolvedValue(null);
        prismaMock.pantryItem.create.mockResolvedValue({ ...mockPantryItem, name: 'Eggs' });

        const result = await upsertPantryItem(1, baseItem);

        expect(prismaMock.pantryItem.create).toHaveBeenCalled();
        expect(result.name).toBe('Eggs');
    });

    it('updates existing item when found by name', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.pantryItem.findFirst.mockResolvedValue(mockPantryItem);
        prismaMock.pantryItem.update.mockResolvedValue({ ...mockPantryItem, isInStock: false });

        await upsertPantryItem(1, { ...baseItem, isInStock: false });

        expect(prismaMock.pantryItem.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: mockPantryItem.id } }),
        );
    });

    it('clears the expiration date when an item is marked out of stock', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.pantryItem.findFirst.mockResolvedValue(mockPantryItem);
        prismaMock.pantryItem.update.mockResolvedValue({ ...mockPantryItem, isInStock: false });

        await upsertPantryItem(1, {
            ...baseItem,
            expiresAt: new Date('2025-12-01'),
            isInStock: false,
        });

        expect(prismaMock.pantryItem.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ expiresAt: null }) }),
        );
    });

    describe('low stock', () => {
        const upsertWith = async (patch: object) => {
            prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
            prismaMock.pantryItem.findFirst.mockResolvedValue(mockPantryItem);
            prismaMock.pantryItem.update.mockResolvedValue(mockPantryItem);
            await upsertPantryItem(1, { ...baseItem, ...patch });
            return prismaMock.pantryItem.update.mock.calls[0][0].data;
        };

        it('marking an item low keeps it in stock', async () => {
            expect(await upsertWith({ isLow: true })).toMatchObject({
                isInStock: true,
                isLow: true,
            });
        });
        it('marking an item out clears low', async () => {
            expect(await upsertWith({ isInStock: false })).toMatchObject({
                isInStock: false,
                isLow: false,
            });
        });
        it('out wins over low when both are sent', async () => {
            expect(await upsertWith({ isInStock: false, isLow: true })).toMatchObject({
                isInStock: false,
                isLow: false,
            });
        });
        it('restocking without saying low clears it', async () => {
            expect(await upsertWith({ isInStock: true })).toMatchObject({
                isInStock: true,
                isLow: false,
            });
        });
        it('an unrelated edit leaves low alone', async () => {
            expect(await upsertWith({ quantity: '2' })).not.toHaveProperty('isLow');
        });
    });

    it('updates existing item when found by id', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.pantryItem.findFirst.mockResolvedValue(mockPantryItem);
        prismaMock.pantryItem.update.mockResolvedValue({ ...mockPantryItem, isFavorite: true });

        await upsertPantryItem(1, { id: 1, isFavorite: true, name: 'Flour', pantryId: 1 });

        expect(prismaMock.pantryItem.findFirst).toHaveBeenCalledWith({
            where: { deletedAt: null, id: 1, pantryId: 1 },
        });
        expect(prismaMock.pantryItem.update).toHaveBeenCalled();
    });

    it("refuses an id that isn't a live item in this pantry", async () => {
        // e.g. another household's item id, or one that was deleted
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue(mockPantry as any);
        prismaMock.pantryItem.findFirst.mockResolvedValue(null);

        await expect(
            upsertPantryItem(1, { id: 777, isFavorite: true, name: 'Flour', pantryId: 1 }),
        ).rejects.toThrow('Pantry item not found');
        expect(prismaMock.pantryItem.update).not.toHaveBeenCalled();
        expect(prismaMock.pantryItem.create).not.toHaveBeenCalled();
    });

    it('throws if pantry does not belong to household', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockRejectedValue(new Error('Pantry not found'));

        await expect(upsertPantryItem(99, baseItem)).rejects.toThrow('Pantry not found');
    });
});

describe('getPantryItem()', () => {
    it('returns a pantry item by householdId, pantryId, and itemId', async () => {
        prismaMock.pantryItem.findUniqueOrThrow.mockResolvedValue(mockPantryItem as any);

        const result = await getPantryItem(1, 1, 1);

        expect(prismaMock.pantryItem.findUniqueOrThrow).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 1, pantry: { householdId: 1 }, pantryId: 1 } }),
        );
        expect(result).toEqual(mockPantryItem);
    });

    it('throws when item is not found', async () => {
        prismaMock.pantryItem.findUniqueOrThrow.mockRejectedValue(new Error('Not found'));

        await expect(getPantryItem(1, 1, 999)).rejects.toThrow('Not found');
    });
});

describe('deletePantryItem()', () => {
    it('soft-deletes the item and takes it off the list, scoped to the household', async () => {
        prismaMock.pantryItem.updateMany.mockResolvedValue({ count: 1 });

        expect(await deletePantryItem(1, 2, 3)).toBe(true);

        expect(prismaMock.pantryItem.updateMany).toHaveBeenCalledWith({
            data: { deletedAt: expect.any(Date), isInShoppingList: false },
            where: { deletedAt: null, id: 3, pantry: { householdId: 1 }, pantryId: 2 },
        });
    });

    it('returns false when nothing matched', async () => {
        prismaMock.pantryItem.updateMany.mockResolvedValue({ count: 0 });

        expect(await deletePantryItem(1, 2, 999)).toBe(false);
    });
});
