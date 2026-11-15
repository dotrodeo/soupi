import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prismaMock } from '../../mocks/prisma';

// Route-level tests: the real Express app (middleware, validation, routing) with
// Clerk, the database and the recipe service mocked out.
vi.mock('@clerk/express', () => ({
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    getAuth: () => ({ userId: 'user_1' }),
}));
vi.mock('../../../prisma/index', () => ({ default: prismaMock }));
vi.mock('../../../src/services/scraper', () => ({ scrapeRecipe: vi.fn() }));
vi.mock('../../../src/services/recipe', () => ({
    upsertRecipe: vi.fn(async (_householdId: number, patch: object) => ({ id: 7, ...patch })),
}));

const { default: app } = await import('../../../src/app');
const recipeService = await import('../../../src/services/recipe');

let server: Server;
let base: string;

beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
    server.close();
});
beforeEach(() => {
    vi.mocked(recipeService.upsertRecipe).mockClear();
    prismaMock.household.findFirst.mockResolvedValue({ id: 1 } as never);
});

const post = (body: object) =>
    fetch(`${base}/household/1/recipes`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });

describe('POST /household/:householdId/recipes', () => {
    it('creates a recipe without tags', async () => {
        const res = await post({ ingredients: ['2 eggs'], name: 'Omelette' });
        expect(res.status).toBe(200);
        expect(recipeService.upsertRecipe).toHaveBeenCalledWith(1, {
            ingredients: ['2 eggs'],
            name: 'Omelette',
        });
    });

    it('creates a recipe with new tags given by name only, as the web app sends them', async () => {
        const res = await post({ name: 'Omelette', tags: [{ name: 'breakfast' }] });
        expect(res.status).toBe(200);
        expect(recipeService.upsertRecipe).toHaveBeenCalledWith(1, {
            name: 'Omelette',
            tags: [{ name: 'breakfast' }],
        });
    });

    it('edits a recipe with tags given by name only', async () => {
        const res = await post({ id: 7, name: 'Omelette', tags: [{ name: 'quick' }] });
        expect(res.status).toBe(200);
    });

    it('still accepts tags with an id', async () => {
        const res = await post({ name: 'Omelette', tags: [{ id: 3, name: 'breakfast' }] });
        expect(res.status).toBe(200);
    });

    it('rejects a tag without a name', async () => {
        const res = await post({ name: 'Omelette', tags: [{ id: 3 }] });
        expect(res.status).toBe(400);
        expect(recipeService.upsertRecipe).not.toHaveBeenCalled();
    });
});
