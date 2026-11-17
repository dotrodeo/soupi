import { beforeEach, vi } from 'vitest';

import { mockCategory, mockPantryItem } from '../../fixtures/pantry';
import { prismaMock } from '../../mocks/prisma';

vi.mock('../../../prisma', () => ({ default: prismaMock }));
vi.mock('../../../utils/sse', () => ({
    addClient: vi.fn(),
    broadcast: vi.fn(
        async (_hid: number, _type: unknown, _from: string, cb: () => Promise<unknown>) => cb(),
    ),
}));

const { addToList, getListByCategory } = await import('../../../src/services/shopping-list');

describe('getListByCategory()', () => {
    it('returns categories with in-stock pantry items', async () => {
        const categoryWithItems = {
            ...mockCategory,
            pantryItems: [mockPantryItem],
        };
        prismaMock.itemCategory.findMany.mockResolvedValue([categoryWithItems] as never);

        const result = await getListByCategory(1, 1);

        expect(result).toEqual([categoryWithItems]);
        expect(prismaMock.itemCategory.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy: { sortOrder: 'asc' },
                where: expect.objectContaining({
                    deletedAt: null,
                    pantry: { householdId: 1 },
                    pantryId: 1,
                }),
            }),
        );
    });

    it('returns empty array when no items are in shopping list', async () => {
        prismaMock.itemCategory.findMany.mockResolvedValue([]);

        const result = await getListByCategory(1, 99);

        expect(result).toEqual([]);
    });
});

describe('addToList()', () => {
    beforeEach(() => {
        prismaMock.pantry.findUniqueOrThrow.mockResolvedValue({ id: 2 } as never);
        prismaMock.$transaction.mockImplementation((async (ops: unknown[]) =>
            Promise.all(ops)) as never);
        prismaMock.pantryItem.updateMany.mockResolvedValue({ count: 0 });
        prismaMock.pantryItem.createMany.mockResolvedValue({ count: 0 });
    });

    it('checks the pantry belongs to the household', async () => {
        prismaMock.pantry.findUniqueOrThrow.mockRejectedValue(new Error('Not found'));

        await expect(addToList(1, 99, { itemIds: [3] })).rejects.toThrow('Not found');
        expect(prismaMock.pantryItem.updateMany).not.toHaveBeenCalled();
    });

    it('flags existing items and creates new ones for unknown names', async () => {
        prismaMock.pantryItem.findMany.mockResolvedValue([{ id: 9, name: 'Onion' }] as never);
        prismaMock.pantryItem.updateMany.mockResolvedValue({ count: 3 });
        prismaMock.pantryItem.createMany.mockResolvedValue({ count: 1 });

        const result = await addToList(1, 2, {
            itemIds: [3, 4],
            names: ['onion', ' fish sauce ', 'Fish Sauce'],
        });

        expect(prismaMock.pantry.findUniqueOrThrow).toHaveBeenCalledWith({
            where: { householdId: 1, id: 2 },
        });
        // Names are trimmed, de-duplicated and matched case-insensitively.
        expect(prismaMock.pantryItem.findMany).toHaveBeenCalledWith({
            select: { id: true, name: true },
            where: {
                deletedAt: null,
                OR: [
                    { name: { equals: 'onion', mode: 'insensitive' } },
                    { name: { equals: 'Fish Sauce', mode: 'insensitive' } },
                ],
                pantryId: 2,
            },
        });
        const flag = prismaMock.pantryItem.updateMany.mock.calls[0][0];
        expect(flag.data).toEqual({ isInShoppingList: true });
        expect(flag.where).toMatchObject({ deletedAt: null, pantryId: 2 });
        expect([...(flag.where!.id as { in: number[] }).in].sort()).toEqual([3, 4, 9]);
        expect(prismaMock.pantryItem.createMany).toHaveBeenCalledWith({
            data: [{ isInShoppingList: true, isInStock: false, name: 'Fish Sauce', pantryId: 2 }],
        });
        expect(result).toEqual({ added: 4 });
    });

    it('skips the name lookup when only ids are given', async () => {
        await addToList(1, 2, { itemIds: [3] });
        expect(prismaMock.pantryItem.findMany).not.toHaveBeenCalled();
    });
});
