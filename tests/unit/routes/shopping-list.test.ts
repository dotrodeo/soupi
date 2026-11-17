import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prismaMock } from '../../mocks/prisma';

// Route-level tests for POST /shopping-list: the real Express app with Clerk, the
// database and the service mocked out.
vi.mock('@clerk/express', () => ({
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    getAuth: () => ({ userId: 'user_1' }),
}));
vi.mock('../../../prisma/index', () => ({ default: prismaMock }));
vi.mock('../../../src/services/scraper', () => ({ scrapeRecipe: vi.fn() }));
vi.mock('../../../src/services/shopping-list', () => ({
    addToList: vi.fn(async () => ({ added: 2 })),
    getListByCategory: vi.fn(async () => []),
}));

const { default: app } = await import('../../../src/app');
const service = await import('../../../src/services/shopping-list');

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
    vi.mocked(service.addToList).mockClear();
    prismaMock.household.findFirst.mockResolvedValue({ id: 1 } as never);
});

const post = (body: object, household = 1) =>
    fetch(`${base}/household/${household}/pantry/2/shopping-list`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });

describe('POST /household/:householdId/pantry/:pantryId/shopping-list', () => {
    it('adds the batch', async () => {
        const res = await post({ itemIds: [3, 4], names: ['fish sauce'] });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ added: 2 });
        expect(service.addToList).toHaveBeenCalledWith(1, 2, {
            itemIds: [3, 4],
            names: ['fish sauce'],
        });
    });

    it('rejects an empty batch', async () => {
        expect((await post({})).status).toBe(400);
        expect((await post({ itemIds: [], names: [] })).status).toBe(400);
        expect(service.addToList).not.toHaveBeenCalled();
    });

    it('rejects blank names and bad ids', async () => {
        expect((await post({ names: ['  '] })).status).toBe(400);
        expect((await post({ itemIds: [-1] })).status).toBe(400);
    });

    it("refuses a household the user isn't in", async () => {
        prismaMock.household.findFirst.mockResolvedValue(null);
        expect((await post({ itemIds: [3] }, 5)).status).toBe(403);
    });
});
