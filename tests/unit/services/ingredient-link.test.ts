import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prismaMock } from '../../mocks/prisma';

vi.mock('../../../prisma/index', () => ({ default: prismaMock }));
vi.mock('../../../utils/sse', () => ({
    addClient: vi.fn(),
    broadcast: vi.fn(
        async (_hid: number, _type: unknown, _from: string, cb: () => Promise<unknown>) => cb(),
    ),
}));

const { deleteLink, listLinks, normalizeIngredientName, upsertLink } = await import(
    '../../../src/services/ingredient-link'
);

beforeEach(() => {
    prismaMock.ingredientLink.upsert.mockResolvedValue({ id: 1 } as never);
});

describe('normalizeIngredientName()', () => {
    it('trims, collapses spaces and lowercases', () => {
        expect(normalizeIngredientName('  Green   Onions ')).toBe('green onions');
    });
});

describe('listLinks()', () => {
    it("lists the household's links with their pantry item", async () => {
        prismaMock.ingredientLink.findMany.mockResolvedValue([]);
        await listLinks(7);
        expect(prismaMock.ingredientLink.findMany).toHaveBeenCalledWith({
            include: { pantryItem: { select: { deletedAt: true, id: true, name: true } } },
            orderBy: { name: 'asc' },
            where: { householdId: 7 },
        });
    });
});

describe('upsertLink()', () => {
    it("links to one of the household's pantry items, by normalized name", async () => {
        prismaMock.pantryItem.findFirst.mockResolvedValue({ id: 3 } as never);

        await upsertLink(7, { name: ' Scallions ', pantryItemId: 3 });

        expect(prismaMock.pantryItem.findFirst).toHaveBeenCalledWith({
            select: { id: true },
            where: { deletedAt: null, id: 3, pantry: { householdId: 7 } },
        });
        expect(prismaMock.ingredientLink.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: { householdId: 7, name: 'scallions', pantryItemId: 3 },
                update: { pantryItemId: 3 },
                where: { householdId_name: { householdId: 7, name: 'scallions' } },
            }),
        );
    });

    it("refuses another household's (or a deleted) pantry item", async () => {
        prismaMock.pantryItem.findFirst.mockResolvedValue(null);

        await expect(upsertLink(7, { name: 'scallions', pantryItemId: 99 })).rejects.toThrow(
            'Pantry item not found',
        );
        expect(prismaMock.ingredientLink.upsert).not.toHaveBeenCalled();
    });

    it('marks an ingredient untracked without a pantry item', async () => {
        await upsertLink(7, { name: 'Water', pantryItemId: null });

        expect(prismaMock.pantryItem.findFirst).not.toHaveBeenCalled();
        expect(prismaMock.ingredientLink.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: { householdId: 7, name: 'water', pantryItemId: null },
            }),
        );
    });
});

describe('deleteLink()', () => {
    it("deletes only the household's link", async () => {
        prismaMock.ingredientLink.deleteMany.mockResolvedValue({ count: 1 });
        await deleteLink(7, 5);
        expect(prismaMock.ingredientLink.deleteMany).toHaveBeenCalledWith({
            where: { householdId: 7, id: 5 },
        });
    });

    it('throws not found otherwise', async () => {
        prismaMock.ingredientLink.deleteMany.mockResolvedValue({ count: 0 });
        await expect(deleteLink(7, 99)).rejects.toThrow('Ingredient link not found');
    });
});
