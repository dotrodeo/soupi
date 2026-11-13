import type { Ingredient, Recipe, RecipeTag } from '@prisma/client';

export const mockIngredient: Ingredient = {
    amount: null,
    createdAt: new Date('2024-01-01'),
    deletedAt: null,
    id: 1,
    item: 'flour',
    json: null,
    preparation: null,
    recipeId: 1,
    sentence: '2 cups flour',
    size: null,
    unit: 'cups',
    updatedAt: new Date('2024-01-01'),
};

export const mockTag: RecipeTag = {
    createdAt: new Date('2024-01-01'),
    householdId: 1,
    id: 1,
    name: 'vegetarian',
    updatedAt: new Date('2024-01-01'),
};

export const mockRecipe: Recipe & { ingredients: Ingredient[]; tags: RecipeTag[] } = {
    cookTime: '30 mins',
    createdAt: new Date('2024-01-01'),
    deletedAt: null,
    householdId: 1,
    id: 1,
    ingredients: [mockIngredient],
    instructions: ['Step 1', 'Step 2'],
    lastMade: null,
    name: 'Test Recipe',
    prepTime: '10 mins',
    rating: 0,
    servings: '4',
    source: null,
    tags: [mockTag],
    timesMade: 0,
    updatedAt: new Date('2024-01-01'),
};

export const mockRecipe2: typeof mockRecipe = {
    ...mockRecipe,
    id: 2,
    name: 'Second Recipe',
};
