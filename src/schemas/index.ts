import { z } from 'zod';

export const RecipeTagSchema = z.object({
    id: z.number().int().positive(),
    name: z.string().min(1),
});

export const UpsertRecipeSchema = z.object({
    cookTime: z.string().nullable().optional(),
    id: z.number().int().positive().optional(),
    ingredients: z.array(z.string()).optional(),
    instructions: z.array(z.string()).nullable().optional(),
    name: z.string().min(1).optional(),
    prepTime: z.string().nullable().optional(),
    servings: z.string().nullable().optional(),
    source: z.string().url().nullable().optional(),
    tags: z.array(RecipeTagSchema).optional(),
});

export const CompleteRecipeSchema = z.object({
    finishedPantryItems: z.array(z.number().int().positive()).optional(),
    rating: z.number().int().min(0).max(5).optional(),
    recipeId: z.number().int().positive(),
});

export const UpsertPantryItemSchema = z.object({
    categoryId: z.number().int().positive().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    id: z.number().int().positive().optional(),
    isFavorite: z.boolean().optional(),
    isInShoppingList: z.boolean().optional(),
    isInStock: z.boolean().optional(),
    name: z.string().min(1),
    purchasedAt: z.coerce.date().nullable().optional(),
    quantity: z.string().nullable().optional(),
});

export const UpsertCategorySchema = z.object({
    icon: z.string().nullable().optional(),
    id: z.number().int().positive().optional(),
    isNonFood: z.boolean().optional(),
    name: z.string().min(1),
    sortOrder: z.number().int().min(0).optional(),
});

export const UpdateSortOrderSchema = z.array(z.number().int().positive());

export const AddPlanDaySchema = z.object({
    date: z.coerce.date(),
    planId: z.number().int().positive(),
});

export const AddRecipesToPlanDaySchema = z.array(z.number().int().positive());

export const UpdateUserSchema = z.object({
    themePreference: z.enum(['system', 'light', 'dark']).optional(),
});

export const JoinHouseholdSchema = z.object({
    // Friendly codes like FERN-2931 (was a UUID); just require a non-empty
    // string and let the service normalize/look it up.
    joinToken: z.string().trim().min(1),
});
