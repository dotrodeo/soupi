import { describe, expect, it, vi } from 'vitest';

import { mockRecipe, mockRecipe2, mockTag } from '../../fixtures/recipe';
import '../../mocks/broadcast';
import { prismaMock } from '../../mocks/prisma';

vi.mock('../../../prisma/index', () => ({ default: prismaMock }));
vi.mock('../../../utils/sse', () => ({
    addClient: vi.fn(),
    broadcast: vi.fn(
        async (_hid: number, _type: unknown, _from: string, cb: () => Promise<unknown>) => cb(),
    ),
}));
vi.mock('../../../src/services/ingredient', () => ({
    parseIngredients: vi.fn().mockResolvedValue(mockRecipe),
}));
vi.mock('../../../src/services/scraper', () => ({
    scrapeRecipe: vi.fn(),
}));

// Import after mocks are set up
const {
    completeRecipe,
    createRecipeFromUrl,
    deleteRecipe,
    getAllRecipes,
    getAllRecipeTags,
    getRecipe,
    upsertRecipe,
} = await import('../../../src/services/recipe');

describe('getAllRecipeTags()', () => {
    it('returns tags for a household ordered by name', async () => {
        prismaMock.recipeTag.findMany.mockResolvedValue([mockTag]);

        const result = await getAllRecipeTags(1);

        expect(prismaMock.recipeTag.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ orderBy: { name: 'asc' }, where: { householdId: 1 } }),
        );
        expect(result).toEqual([mockTag]);
    });
});

describe('upsertRecipe()', () => {
    it('creates a new recipe when no id is provided', async () => {
        prismaMock.recipe.create.mockResolvedValue(mockRecipe);
        prismaMock.recipe.findUniqueOrThrow.mockResolvedValue(mockRecipe);
        prismaMock.$transaction.mockResolvedValue([]);

        await upsertRecipe(1, { ingredients: ['1 cup flour'], name: 'Pancakes' });

        expect(prismaMock.recipe.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ householdId: 1, name: 'Pancakes' }),
            }),
        );
    });

    it('updates an existing recipe when id is provided', async () => {
        prismaMock.recipe.update.mockResolvedValue(mockRecipe);
        prismaMock.recipe.findUniqueOrThrow.mockResolvedValue(mockRecipe);
        prismaMock.$transaction.mockResolvedValue([]);

        await upsertRecipe(1, { id: 1, name: 'Updated Pancakes' });

        expect(prismaMock.recipe.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { householdId: 1, id: 1 },
            }),
        );
    });

    it('finds or creates tags in the household and connects them on create', async () => {
        prismaMock.recipe.create.mockResolvedValue(mockRecipe);
        prismaMock.$transaction.mockResolvedValueOnce([{ ...mockTag, id: 7 }]);

        await upsertRecipe(1, {
            name: 'Tagged Recipe',
            tags: [
                { id: 0, name: 'vegan' },
                { id: 0, name: 'vegan' },
            ],
        });

        expect(prismaMock.recipeTag.upsert).toHaveBeenCalledTimes(1);
        expect(prismaMock.recipeTag.upsert).toHaveBeenCalledWith({
            create: { householdId: 1, name: 'vegan' },
            update: {},
            where: { householdId_name: { householdId: 1, name: 'vegan' } },
        });
        expect(prismaMock.recipe.create).toHaveBeenCalledWith({
            data: { householdId: 1, name: 'Tagged Recipe', tags: { connect: [{ id: 7 }] } },
        });
    });

    it('replaces the tag set on update', async () => {
        prismaMock.recipe.update.mockResolvedValue(mockRecipe);
        prismaMock.$transaction.mockResolvedValueOnce([
            { ...mockTag, id: 7 },
            { ...mockTag, id: 8 },
        ]);

        await upsertRecipe(1, {
            id: 1,
            name: 'Soup',
            tags: [
                { id: 0, name: 'dinner' },
                { id: 0, name: 'quick' },
            ],
        });

        expect(prismaMock.recipe.update).toHaveBeenCalledWith({
            data: { name: 'Soup', tags: { set: [{ id: 7 }, { id: 8 }] } },
            where: { householdId: 1, id: 1 },
        });
    });

    it('clears tags on update when given an empty list', async () => {
        prismaMock.recipe.update.mockResolvedValue(mockRecipe);
        prismaMock.$transaction.mockResolvedValueOnce([]);

        await upsertRecipe(1, { id: 1, name: 'Soup', tags: [] });

        expect(prismaMock.recipe.update).toHaveBeenCalledWith({
            data: { name: 'Soup', tags: { set: [] } },
            where: { householdId: 1, id: 1 },
        });
    });

    it('leaves tags unchanged on update when tags are omitted', async () => {
        prismaMock.recipe.update.mockResolvedValue(mockRecipe);

        await upsertRecipe(1, { id: 1, name: 'Soup' });

        expect(prismaMock.recipeTag.upsert).not.toHaveBeenCalled();
        expect(prismaMock.recipe.update).toHaveBeenCalledWith({
            data: { name: 'Soup' },
            where: { householdId: 1, id: 1 },
        });
    });
});

describe('getAllRecipes()', () => {
    it('returns paginated recipes with default page/limit', async () => {
        prismaMock.recipe.findMany.mockResolvedValue([mockRecipe, mockRecipe2]);

        const results = await getAllRecipes(1);

        expect(prismaMock.recipe.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                skip: 0,
                take: 50,
                where: { deletedAt: null, householdId: 1 },
            }),
        );
        expect(results).toHaveLength(2);
    });

    it('applies custom page and limit', async () => {
        prismaMock.recipe.findMany.mockResolvedValue([mockRecipe]);

        await getAllRecipes(1, { limit: 10, page: 2 });

        expect(prismaMock.recipe.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ skip: 10, take: 10 }),
        );
    });

    it('filters by householdId and excludes soft-deleted', async () => {
        prismaMock.recipe.findMany.mockResolvedValue([]);

        await getAllRecipes(42);

        expect(prismaMock.recipe.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { deletedAt: null, householdId: 42 },
            }),
        );
    });
});

describe('getRecipe()', () => {
    it('returns recipe matching householdId and id', async () => {
        prismaMock.recipe.findUniqueOrThrow.mockResolvedValue(mockRecipe);

        const result = await getRecipe(1, 1);

        expect(prismaMock.recipe.findUniqueOrThrow).toHaveBeenCalledWith(
            expect.objectContaining({ where: { householdId: 1, id: 1 } }),
        );
        expect(result.id).toBe(1);
    });

    it('throws if recipe not found (Prisma throws)', async () => {
        prismaMock.recipe.findUniqueOrThrow.mockRejectedValue(new Error('Not found'));

        await expect(getRecipe(1, 999)).rejects.toThrow('Not found');
    });
});

describe('deleteRecipe()', () => {
    it('soft-deletes by setting deletedAt', async () => {
        prismaMock.recipe.update.mockResolvedValue({ ...mockRecipe, deletedAt: new Date() });

        await deleteRecipe(1, 1);

        expect(prismaMock.recipe.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ deletedAt: expect.any(Date) }),
                where: { householdId: 1, id: 1 },
            }),
        );
    });
});

describe('completeRecipe()', () => {
    it('increments timesMade and sets lastMade', async () => {
        // $transaction: call the callback
        prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
        prismaMock.recipe.findFirstOrThrow.mockResolvedValue(mockRecipe);
        prismaMock.recipe.update.mockResolvedValue({ ...mockRecipe, timesMade: 1 });
        prismaMock.pantryItem.findMany.mockResolvedValue([]);
        prismaMock.planDay.findMany.mockResolvedValue([]);

        await completeRecipe(1, { rating: 4, recipeId: 1 });

        expect(prismaMock.recipe.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    lastMade: expect.any(Date),
                    timesMade: { increment: 1 },
                }),
            }),
        );
    });

    it('marks finished pantry items as out of stock', async () => {
        prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
        prismaMock.recipe.findFirstOrThrow.mockResolvedValue(mockRecipe);
        prismaMock.recipe.update.mockResolvedValue(mockRecipe);
        prismaMock.pantryItem.findMany.mockResolvedValue([{ id: 10, isFavorite: false } as any]);
        prismaMock.pantryItem.update.mockResolvedValue({} as any);
        prismaMock.planDay.findMany.mockResolvedValue([]);

        await completeRecipe(1, { finishedPantryItems: [10], recipeId: 1 });

        expect(prismaMock.pantryItem.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ isInStock: false }),
                where: { id: 10 },
            }),
        );
    });

    it('adds favorite finished items to shopping list', async () => {
        prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
        prismaMock.recipe.findFirstOrThrow.mockResolvedValue(mockRecipe);
        prismaMock.recipe.update.mockResolvedValue(mockRecipe);
        prismaMock.pantryItem.findMany.mockResolvedValue([{ id: 10, isFavorite: true } as any]);
        prismaMock.pantryItem.update.mockResolvedValue({} as any);
        prismaMock.planDay.findMany.mockResolvedValue([]);

        await completeRecipe(1, { finishedPantryItems: [10], recipeId: 1 });

        expect(prismaMock.pantryItem.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ isInShoppingList: true }),
            }),
        );
    });
});

describe('createRecipeFromUrl()', () => {
    it('throws when scraper returns null', async () => {
        const { scrapeRecipe } = await import('../../../src/services/scraper');
        vi.mocked(scrapeRecipe).mockResolvedValue(null);

        await expect(createRecipeFromUrl(1, 'https://example.com/recipe')).rejects.toThrow(
            'Failed to scrape recipe from URL',
        );
    });

    it('creates recipe from scraped data including ISO duration parsing', async () => {
        const { scrapeRecipe } = await import('../../../src/services/scraper');
        vi.mocked(scrapeRecipe).mockResolvedValue({
            cookTime: 'PT30M',
            ingredients: ['1 cup flour'],
            instructions: ['Mix ingredients'],
            name: 'Scraped Cake',
            prepTime: 'PT90M',
            servings: '4',
        } as never);
        prismaMock.recipe.create.mockResolvedValue(mockRecipe);
        prismaMock.recipe.findUniqueOrThrow.mockResolvedValue(mockRecipe);
        prismaMock.$transaction.mockResolvedValue([]);

        await createRecipeFromUrl(1, 'https://example.com/recipe');

        expect(prismaMock.recipe.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    cookTime: '30 mins',
                    prepTime: '1 hour 30 mins',
                    source: 'https://example.com/recipe',
                }),
            }),
        );
    });
});
