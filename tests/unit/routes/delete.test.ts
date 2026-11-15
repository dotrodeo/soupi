import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prismaMock } from '../../mocks/prisma';

// Route-level tests for the pantry item and category DELETE endpoints: the real
// Express app with Clerk, the database and the services mocked out.
vi.mock('@clerk/express', () => ({
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    getAuth: () => ({ userId: 'user_1' }),
}));
vi.mock('../../../prisma/index', () => ({ default: prismaMock }));
vi.mock('../../../src/services/scraper', () => ({ scrapeRecipe: vi.fn() }));
vi.mock('../../../src/services/pantry', () => ({ deletePantryItem: vi.fn() }));
vi.mock('../../../src/services/category', () => ({ deleteCategory: vi.fn() }));

const { default: app } = await import('../../../src/app');
const pantryService = await import('../../../src/services/pantry');
const categoryService = await import('../../../src/services/category');

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
    vi.mocked(pantryService.deletePantryItem).mockReset();
    vi.mocked(categoryService.deleteCategory).mockReset();
    prismaMock.household.findFirst.mockResolvedValue({ id: 1 } as never);
});

const del = (path: string) => fetch(`${base}${path}`, { method: 'DELETE' });

describe('DELETE /household/:householdId/pantry/:pantryId/items/:itemId', () => {
    it('deletes the item and replies 204', async () => {
        vi.mocked(pantryService.deletePantryItem).mockResolvedValue(true);

        const res = await del('/household/1/pantry/2/items/3');

        expect(res.status).toBe(204);
        expect(pantryService.deletePantryItem).toHaveBeenCalledWith(1, 2, 3);
    });

    it("replies 404 when the item isn't in the household's pantry", async () => {
        vi.mocked(pantryService.deletePantryItem).mockResolvedValue(false);

        const res = await del('/household/1/pantry/2/items/999');

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Pantry item not found' });
    });

    it('replies 403 for a household the user is not in', async () => {
        prismaMock.household.findFirst.mockResolvedValue(null);

        const res = await del('/household/5/pantry/2/items/3');

        expect(res.status).toBe(403);
        expect(pantryService.deletePantryItem).not.toHaveBeenCalled();
    });
});

describe('DELETE /household/:householdId/pantry/:pantryId/category/:categoryId', () => {
    it('deletes the category and replies 204', async () => {
        vi.mocked(categoryService.deleteCategory).mockResolvedValue(true);

        const res = await del('/household/1/pantry/2/category/7');

        expect(res.status).toBe(204);
        expect(categoryService.deleteCategory).toHaveBeenCalledWith(1, 2, 7);
    });

    it("replies 404 when the category isn't in the household's pantry", async () => {
        vi.mocked(categoryService.deleteCategory).mockResolvedValue(false);

        const res = await del('/household/1/pantry/2/category/999');

        expect(res.status).toBe(404);
    });
});
