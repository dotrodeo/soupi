import {
    extendZodWithOpenApi,
    OpenApiGeneratorV3,
    OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { z } from 'zod';

extendZodWithOpenApi(z);

import PackageJson from '../../package.json';
import {
    AddPlanDaySchema,
    AddRecipesToPlanDaySchema,
    CompleteRecipeSchema,
    JoinHouseholdSchema,
    UpdateSortOrderSchema,
    UpdateUserSchema,
    UpsertCategorySchema,
    UpsertPantryItemSchema,
    UpsertRecipeSchema,
} from '../schemas';

const registry = new OpenAPIRegistry();

// ─── Reusable param schemas ───────────────────────────────────────────────────

const HouseholdIdParam = z.coerce.number().int().positive().openapi({ example: 1 });
const PantryIdParam = z.coerce.number().int().positive().openapi({ example: 1 });
const CategoryIdParam = z.coerce.number().int().positive().openapi({ example: 1 });
const RecipeIdParam = z.coerce.number().int().positive().openapi({ example: 1 });
const ItemIdParam = z.coerce.number().int().positive().openapi({ example: 1 });
const PlanDayIdParam = z.coerce.number().int().positive().openapi({ example: 1 });

const householdParams = z.object({ householdId: HouseholdIdParam });
const pantryParams = z.object({ householdId: HouseholdIdParam, pantryId: PantryIdParam });
const categoryParams = z.object({
    categoryId: CategoryIdParam,
    householdId: HouseholdIdParam,
    pantryId: PantryIdParam,
});
const recipeParams = z.object({ householdId: HouseholdIdParam, id: RecipeIdParam });
const itemParams = z.object({
    householdId: HouseholdIdParam,
    itemId: ItemIdParam,
    pantryId: PantryIdParam,
});
const planDayParams = z.object({ householdId: HouseholdIdParam, planDayId: PlanDayIdParam });
const planDayRecipeParams = z.object({
    householdId: HouseholdIdParam,
    planDayId: PlanDayIdParam,
    recipeId: RecipeIdParam,
});

// ─── Security scheme ──────────────────────────────────────────────────────────

registry.registerComponent('securitySchemes', 'ClerkAuth', {
    description: 'Clerk session token (set automatically via cookies)',
    in: 'cookie',
    name: 'session',
    type: 'apiKey',
});

const secured = [{ ClerkAuth: [] }];

// ─── Health & Meta ────────────────────────────────────────────────────────────

registry.registerPath({
    method: 'get',
    path: '/health',
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ status: z.string() }) } },
            description: 'Service is healthy',
        },
        503: {
            content: { 'application/json': { schema: z.object({ status: z.string() }) } },
            description: 'Service is unhealthy',
        },
    },
    summary: 'Health check',
    tags: ['System'],
});

registry.registerPath({
    method: 'get',
    path: '/meta',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({ name: z.string(), status: z.string(), version: z.string() }),
                },
            },
            description: 'App metadata',
        },
    },
    summary: 'App metadata',
    tags: ['System'],
});

// ─── User ─────────────────────────────────────────────────────────────────────

registry.registerPath({
    method: 'get',
    path: '/user',
    responses: { 200: { description: 'Current user data' }, 401: { description: 'Unauthorized' } },
    security: secured,
    summary: 'Get current user',
    tags: ['User'],
});

registry.registerPath({
    method: 'post',
    path: '/user',
    request: { body: { content: { 'application/json': { schema: UpdateUserSchema } } } },
    responses: {
        200: { description: 'Updated user' },
        400: { description: 'Invalid body' },
        401: { description: 'Unauthorized' },
    },
    security: secured,
    summary: 'Update user preferences',
    tags: ['User'],
});

registry.registerPath({
    method: 'post',
    path: '/user/sync',
    responses: {
        200: { description: 'User synced from Clerk' },
        401: { description: 'Unauthorized' },
    },
    security: secured,
    summary: 'Sync user from Clerk',
    tags: ['User'],
});

// ─── Household ────────────────────────────────────────────────────────────────

registry.registerPath({
    method: 'post',
    path: '/household/{householdId}/join',
    request: {
        body: { content: { 'application/json': { schema: JoinHouseholdSchema } } },
        params: householdParams,
    },
    responses: {
        200: { description: 'Joined household successfully' },
        400: { description: 'Invalid body or householdId' },
        403: { description: 'Invalid join token' },
    },
    security: secured,
    summary: 'Join a household with a token',
    tags: ['Household'],
});

// ─── Recipes ──────────────────────────────────────────────────────────────────

registry.registerPath({
    method: 'get',
    path: '/household/{householdId}/recipes',
    request: {
        params: householdParams,
        query: z.object({
            limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
            page: z.coerce.number().int().min(1).default(1).optional(),
        }),
    },
    responses: {
        200: { description: 'Paginated list of recipes' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'List recipes',
    tags: ['Recipes'],
});

registry.registerPath({
    method: 'post',
    path: '/household/{householdId}/recipes',
    request: {
        body: { content: { 'application/json': { schema: UpsertRecipeSchema } } },
        params: householdParams,
    },
    responses: {
        200: { description: 'Recipe created or updated' },
        400: { description: 'Invalid body' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Create or update a recipe',
    tags: ['Recipes'],
});

registry.registerPath({
    method: 'post',
    path: '/household/{householdId}/recipes/from-url',
    request: {
        params: householdParams,
        query: z.object({
            url: z.string().url().openapi({ example: 'https://example.com/recipe' }),
        }),
    },
    responses: {
        200: { description: 'Recipe scraped and saved' },
        400: { description: 'Missing or invalid url' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Create a recipe by scraping a URL',
    tags: ['Recipes'],
});

registry.registerPath({
    method: 'get',
    path: '/household/{householdId}/recipes/tags',
    request: { params: householdParams },
    responses: {
        200: { description: 'List of recipe tags' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'List all recipe tags',
    tags: ['Recipes'],
});

registry.registerPath({
    method: 'get',
    path: '/household/{householdId}/recipes/scrape',
    request: {
        params: householdParams,
        query: z.object({
            url: z.string().url().openapi({ example: 'https://example.com/recipe' }),
        }),
    },
    responses: {
        200: { description: 'Scraped recipe metadata (not saved)' },
        400: { description: 'Missing url param' },
    },
    security: secured,
    summary: 'Preview recipe metadata from a URL without saving',
    tags: ['Recipes'],
});

registry.registerPath({
    method: 'get',
    path: '/household/{householdId}/recipes/{id}',
    request: { params: recipeParams },
    responses: {
        200: { description: 'Recipe details' },
        403: { description: 'Access denied' },
        404: { description: 'Not found' },
    },
    security: secured,
    summary: 'Get a recipe',
    tags: ['Recipes'],
});

registry.registerPath({
    method: 'delete',
    path: '/household/{householdId}/recipes/{id}',
    request: { params: recipeParams },
    responses: { 200: { description: 'Recipe deleted' }, 403: { description: 'Access denied' } },
    security: secured,
    summary: 'Delete a recipe',
    tags: ['Recipes'],
});

registry.registerPath({
    method: 'post',
    path: '/household/{householdId}/recipes/{id}/made',
    request: {
        body: { content: { 'application/json': { schema: CompleteRecipeSchema } } },
        params: recipeParams,
    },
    responses: {
        200: { description: 'Recipe marked as made; pantry items updated' },
        400: { description: 'Invalid body' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Mark a recipe as made',
    tags: ['Recipes'],
});

// ─── Pantry ───────────────────────────────────────────────────────────────────

registry.registerPath({
    method: 'get',
    path: '/household/{householdId}/pantry',
    request: { params: householdParams },
    responses: {
        200: { description: "Household's default pantry with items and categories" },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Get pantry',
    tags: ['Pantry'],
});

registry.registerPath({
    method: 'post',
    path: '/household/{householdId}/pantry/{pantryId}',
    request: {
        body: { content: { 'application/json': { schema: UpsertPantryItemSchema } } },
        params: pantryParams,
    },
    responses: {
        200: { description: 'Pantry item created or updated' },
        400: { description: 'Invalid body' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Create or update a pantry item',
    tags: ['Pantry'],
});

registry.registerPath({
    method: 'get',
    path: '/household/{householdId}/pantry/{pantryId}/items',
    request: { params: pantryParams },
    responses: {
        200: { description: 'List of pantry items' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'List all pantry items',
    tags: ['Pantry'],
});

registry.registerPath({
    method: 'get',
    path: '/household/{householdId}/pantry/{pantryId}/items/{itemId}',
    request: { params: itemParams },
    responses: {
        200: { description: 'Pantry item details' },
        403: { description: 'Access denied' },
        404: { description: 'Not found' },
    },
    security: secured,
    summary: 'Get a pantry item',
    tags: ['Pantry'],
});

// ─── Categories ───────────────────────────────────────────────────────────────

registry.registerPath({
    method: 'get',
    path: '/household/{householdId}/pantry/{pantryId}/category',
    request: { params: pantryParams },
    responses: {
        200: { description: 'Categories sorted by sortOrder' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'List item categories',
    tags: ['Categories'],
});

registry.registerPath({
    method: 'post',
    path: '/household/{householdId}/pantry/{pantryId}/category',
    request: {
        body: { content: { 'application/json': { schema: UpsertCategorySchema } } },
        params: pantryParams,
    },
    responses: {
        200: { description: 'Category created or updated' },
        400: { description: 'Invalid body' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Create or update a category',
    tags: ['Categories'],
});

registry.registerPath({
    method: 'get',
    path: '/household/{householdId}/pantry/{pantryId}/category/{categoryId}',
    request: { params: categoryParams },
    responses: {
        200: { description: 'Category details' },
        403: { description: 'Access denied' },
        404: { description: 'Not found' },
    },
    security: secured,
    summary: 'Get a category',
    tags: ['Categories'],
});

registry.registerPath({
    method: 'post',
    path: '/household/{householdId}/pantry/{pantryId}/category/sort-order',
    request: {
        body: { content: { 'application/json': { schema: UpdateSortOrderSchema } } },
        params: pantryParams,
    },
    responses: {
        200: { description: 'Sort order updated' },
        400: { description: 'Invalid body' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Reorder categories',
    tags: ['Categories'],
});

// ─── Shopping List ────────────────────────────────────────────────────────────

registry.registerPath({
    method: 'get',
    path: '/household/{householdId}/pantry/{pantryId}/shopping-list',
    request: { params: pantryParams },
    responses: {
        200: { description: 'Items grouped by category that are on the shopping list' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Get shopping list grouped by category',
    tags: ['Shopping List'],
});

// ─── Meal Plan ────────────────────────────────────────────────────────────────

registry.registerPath({
    method: 'get',
    path: '/household/{householdId}/plan',
    request: { params: householdParams },
    responses: {
        200: { description: 'Meal plan with days and recipes' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Get meal plan',
    tags: ['Meal Plan'],
});

registry.registerPath({
    method: 'post',
    path: '/household/{householdId}/plan/day',
    request: {
        body: { content: { 'application/json': { schema: AddPlanDaySchema } } },
        params: householdParams,
    },
    responses: {
        200: { description: 'Plan day added' },
        400: { description: 'Invalid body' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Add a day to the meal plan',
    tags: ['Meal Plan'],
});

registry.registerPath({
    method: 'delete',
    path: '/household/{householdId}/plan/day/{planDayId}',
    request: { params: planDayParams },
    responses: { 200: { description: 'Plan day removed' }, 403: { description: 'Access denied' } },
    security: secured,
    summary: 'Remove a day from the meal plan',
    tags: ['Meal Plan'],
});

registry.registerPath({
    method: 'post',
    path: '/household/{householdId}/plan/day/{planDayId}/recipes',
    request: {
        body: { content: { 'application/json': { schema: AddRecipesToPlanDaySchema } } },
        params: planDayParams,
    },
    responses: {
        200: { description: 'Recipes added to plan day' },
        400: { description: 'Invalid body' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Add recipes to a plan day',
    tags: ['Meal Plan'],
});

registry.registerPath({
    method: 'delete',
    path: '/household/{householdId}/plan/day/{planDayId}/recipes/{recipeId}',
    request: { params: planDayRecipeParams },
    responses: {
        200: { description: 'Recipe removed from plan day' },
        403: { description: 'Access denied' },
    },
    security: secured,
    summary: 'Remove a recipe from a plan day',
    tags: ['Meal Plan'],
});

// ─── Events (SSE) ─────────────────────────────────────────────────────────────

registry.registerPath({
    method: 'get',
    path: '/events/{householdId}',
    request: { params: z.object({ householdId: HouseholdIdParam }) },
    responses: {
        200: { description: 'SSE stream of real-time household events' },
        401: { description: 'Unauthorized' },
    },
    security: secured,
    summary: 'Subscribe to real-time household events (SSE)',
    tags: ['Events'],
});

// ─── Generate spec & serve ────────────────────────────────────────────────────

const generator = new OpenApiGeneratorV3(registry.definitions);
const spec = generator.generateDocument({
    info: {
        description: 'API for the Soupi household recipe and pantry management app',
        title: 'Soupi API',
        version: PackageJson.version,
    },
    openapi: '3.0.0',
});

const router = Router();

router.get('/spec.json', (_req, res) => res.json(spec));
router.use('/', swaggerUi.serve, swaggerUi.setup(spec));

export default router;
