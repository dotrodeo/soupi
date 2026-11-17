import { z } from 'zod';

// Tags are resolved by name within the household (services/recipe.ts), so a tag in a
// request needs only its name; new tags have no id yet.
export const RecipeTagSchema = z.object({
    id: z.number().int().positive().optional(),
    name: z.string().min(1),
});

export const UpsertRecipeSchema = z.object({
    cookTime: z.string().nullable().optional(),
    id: z.number().int().positive().optional(),
    ingredients: z.array(z.string()).optional(),
    instructions: z.array(z.string()).nullable().optional(),
    name: z.string().min(1).optional(),
    /** Free-text notes kept with the recipe. */
    notes: z.string().max(10000).nullable().optional(),
    prepTime: z.string().nullable().optional(),
    servings: z.string().nullable().optional(),
    source: z.string().url().nullable().optional(),
    tags: z.array(RecipeTagSchema).optional(),
});

export const CompleteRecipeSchema = z.object({
    finishedPantryItems: z.array(z.number().int().positive()).optional(),
    /** Pantry items that are now running low (kept in stock, marked low). */
    lowPantryItems: z.array(z.number().int().positive()).optional(),
    /** A line to add to the end of the recipe's notes, such as "Nov 17: needed 5 more minutes". */
    note: z.string().trim().min(1).max(1000).optional(),
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
    isLow: z.boolean().optional(),
    name: z.string().min(1),
    purchasedAt: z.coerce.date().nullable().optional(),
    quantity: z.string().nullable().optional(),
});

/** Items to put on the shopping list at once: existing pantry items by id, and
 *  ingredients with no pantry item yet by name. */
export const AddToShoppingListSchema = z
    .object({
        itemIds: z.array(z.number().int().positive()).max(200).optional(),
        names: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
    })
    .refine((b) => (b.itemIds?.length ?? 0) + (b.names?.length ?? 0) > 0, {
        message: 'Nothing to add',
    });

/** How an ingredient matches the pantry: a pantry item, or null for "always
 *  have, don't track". `name` is the ingredient's name (normalized by the server). */
export const UpsertIngredientLinkSchema = z.object({
    name: z.string().trim().min(1).max(100),
    pantryItemId: z.number().int().positive().nullable(),
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

// ─── Web push and timer alerts (sous-web#22) ─────────────────────────────────

export const PushSubscriptionSchema = z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({
        auth: z.string().min(1).max(100),
        p256dh: z.string().min(1).max(200),
    }),
});

export const DeletePushSubscriptionSchema = z.object({
    endpoint: z.string().url().max(1000),
});

/** A running timer on the device behind `subscriptionId`. The client sends the
 *  time left rather than an end time, so device clock drift doesn't matter. */
export const UpsertTimerSchema = z.object({
    detail: z.string().max(120),
    label: z.string().min(1).max(80),
    recipeId: z.number().int().positive().nullable().optional(),
    remainingMs: z
        .number()
        .int()
        .min(1000)
        .max(24 * 60 * 60 * 1000),
    subscriptionId: z.number().int().positive(),
});

export const TimerIdSchema = z.string().uuid();
