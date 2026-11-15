import { describe, expect, it } from 'vitest';

import {
    AddPlanDaySchema,
    AddRecipesToPlanDaySchema,
    CompleteRecipeSchema,
    JoinHouseholdSchema,
    RecipeTagSchema,
    UpdateSortOrderSchema,
    UpdateUserSchema,
    UpsertCategorySchema,
    UpsertPantryItemSchema,
    UpsertRecipeSchema,
} from '../../src/schemas/index';

describe('RecipeTagSchema', () => {
    it('accepts valid tag', () => {
        expect(RecipeTagSchema.safeParse({ id: 1, name: 'vegetarian' }).success).toBe(true);
    });
    it('accepts a tag with only a name (new tags have no id)', () => {
        expect(RecipeTagSchema.safeParse({ name: 'vegetarian' }).success).toBe(true);
    });
    it('rejects missing name', () => {
        expect(RecipeTagSchema.safeParse({ id: 1 }).success).toBe(false);
    });
    it('rejects non-positive id', () => {
        expect(RecipeTagSchema.safeParse({ id: 0, name: 'x' }).success).toBe(false);
    });
});

describe('UpsertRecipeSchema', () => {
    it('accepts empty object (all fields optional)', () => {
        expect(UpsertRecipeSchema.safeParse({}).success).toBe(true);
    });
    it('accepts full valid recipe', () => {
        const result = UpsertRecipeSchema.safeParse({
            cookTime: '20 mins',
            id: 1,
            ingredients: ['200g pasta', '1 tsp salt'],
            instructions: ['Boil water', 'Cook pasta'],
            name: 'Pasta',
            prepTime: '10 mins',
            servings: '4',
            source: 'https://example.com/pasta',
            tags: [{ id: 1, name: 'italian' }],
        });
        expect(result.success).toBe(true);
    });
    it('accepts null nullable fields', () => {
        expect(
            UpsertRecipeSchema.safeParse({ cookTime: null, prepTime: null, servings: null })
                .success,
        ).toBe(true);
    });
    it('rejects invalid URL in source', () => {
        expect(UpsertRecipeSchema.safeParse({ source: 'not-a-url' }).success).toBe(false);
    });
    it('rejects non-array instructions', () => {
        expect(UpsertRecipeSchema.safeParse({ instructions: 'do it' }).success).toBe(false);
    });
});

describe('CompleteRecipeSchema', () => {
    it('accepts recipeId only', () => {
        expect(CompleteRecipeSchema.safeParse({ recipeId: 1 }).success).toBe(true);
    });
    it('accepts full completion', () => {
        expect(
            CompleteRecipeSchema.safeParse({
                finishedPantryItems: [1, 2, 3],
                lowPantryItems: [4],
                rating: 4,
                recipeId: 1,
            }).success,
        ).toBe(true);
    });
    it('rejects missing recipeId', () => {
        expect(CompleteRecipeSchema.safeParse({ rating: 5 }).success).toBe(false);
    });
    it('rejects rating above 5', () => {
        expect(CompleteRecipeSchema.safeParse({ rating: 6, recipeId: 1 }).success).toBe(false);
    });
    it('rejects rating below 0', () => {
        expect(CompleteRecipeSchema.safeParse({ rating: -1, recipeId: 1 }).success).toBe(false);
    });
    it('rejects non-integer rating', () => {
        expect(CompleteRecipeSchema.safeParse({ rating: 4.5, recipeId: 1 }).success).toBe(false);
    });
});

describe('UpsertPantryItemSchema', () => {
    it('accepts minimal item', () => {
        expect(UpsertPantryItemSchema.safeParse({ name: 'Flour' }).success).toBe(true);
    });
    it('accepts full item', () => {
        expect(
            UpsertPantryItemSchema.safeParse({
                categoryId: 2,
                expiresAt: null,
                id: 1,
                isFavorite: false,
                isInShoppingList: false,
                isInStock: true,
                name: 'Flour',
                purchasedAt: '2024-01-01',
            }).success,
        ).toBe(true);
    });
    it('rejects missing name', () => {
        expect(UpsertPantryItemSchema.safeParse({ isInStock: true }).success).toBe(false);
    });
    it('coerces date strings to Date', () => {
        const result = UpsertPantryItemSchema.safeParse({
            name: 'Eggs',
            purchasedAt: '2024-06-01',
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.purchasedAt).toBeInstanceOf(Date);
    });
});

describe('UpsertCategorySchema', () => {
    it('accepts minimal category', () => {
        expect(UpsertCategorySchema.safeParse({ name: 'Dairy' }).success).toBe(true);
    });
    it('accepts full category', () => {
        expect(
            UpsertCategorySchema.safeParse({
                icon: '🥦',
                id: 1,
                isNonFood: false,
                name: 'Produce',
                sortOrder: 0,
            }).success,
        ).toBe(true);
    });
    it('rejects missing name', () => {
        expect(UpsertCategorySchema.safeParse({ icon: '🥦' }).success).toBe(false);
    });
    it('rejects negative sortOrder', () => {
        expect(UpsertCategorySchema.safeParse({ name: 'X', sortOrder: -1 }).success).toBe(false);
    });
});

describe('UpdateSortOrderSchema', () => {
    it('accepts array of positive integers', () => {
        expect(UpdateSortOrderSchema.safeParse([3, 1, 2]).success).toBe(true);
    });
    it('accepts empty array', () => {
        expect(UpdateSortOrderSchema.safeParse([]).success).toBe(true);
    });
    it('rejects non-array', () => {
        expect(UpdateSortOrderSchema.safeParse({ ids: [1, 2] }).success).toBe(false);
    });
    it('rejects array with non-positive integer', () => {
        expect(UpdateSortOrderSchema.safeParse([1, 0, 2]).success).toBe(false);
    });
});

describe('AddPlanDaySchema', () => {
    it('accepts valid planId and date string', () => {
        const result = AddPlanDaySchema.safeParse({ date: '2024-06-15', planId: 1 });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.date).toBeInstanceOf(Date);
    });
    it('accepts Date object directly', () => {
        expect(AddPlanDaySchema.safeParse({ date: new Date(), planId: 1 }).success).toBe(true);
    });
    it('rejects missing planId', () => {
        expect(AddPlanDaySchema.safeParse({ date: '2024-06-15' }).success).toBe(false);
    });
    it('rejects missing date', () => {
        expect(AddPlanDaySchema.safeParse({ planId: 1 }).success).toBe(false);
    });
});

describe('AddRecipesToPlanDaySchema', () => {
    it('accepts array of positive integers', () => {
        expect(AddRecipesToPlanDaySchema.safeParse([1, 2, 3]).success).toBe(true);
    });
    it('rejects array with zero', () => {
        expect(AddRecipesToPlanDaySchema.safeParse([0]).success).toBe(false);
    });
    it('rejects non-array', () => {
        expect(AddRecipesToPlanDaySchema.safeParse(1).success).toBe(false);
    });
});

describe('UpdateUserSchema', () => {
    it('accepts valid themePreference values', () => {
        expect(UpdateUserSchema.safeParse({ themePreference: 'light' }).success).toBe(true);
        expect(UpdateUserSchema.safeParse({ themePreference: 'dark' }).success).toBe(true);
        expect(UpdateUserSchema.safeParse({ themePreference: 'system' }).success).toBe(true);
    });
    it('accepts empty object', () => {
        expect(UpdateUserSchema.safeParse({}).success).toBe(true);
    });
    it('rejects invalid themePreference', () => {
        expect(UpdateUserSchema.safeParse({ themePreference: 'auto' }).success).toBe(false);
    });
});

describe('JoinHouseholdSchema', () => {
    it('accepts a friendly join code', () => {
        expect(JoinHouseholdSchema.safeParse({ joinToken: 'FERN-2931' }).success).toBe(true);
    });
    it('still accepts a legacy UUID token', () => {
        expect(
            JoinHouseholdSchema.safeParse({ joinToken: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
                .success,
        ).toBe(true);
    });
    it('trims surrounding whitespace', () => {
        const result = JoinHouseholdSchema.safeParse({ joinToken: '  FERN-2931 ' });
        expect(result.success && result.data.joinToken).toBe('FERN-2931');
    });
    it('rejects an empty join token', () => {
        expect(JoinHouseholdSchema.safeParse({ joinToken: '   ' }).success).toBe(false);
    });
    it('rejects missing joinToken', () => {
        expect(JoinHouseholdSchema.safeParse({}).success).toBe(false);
    });
});
