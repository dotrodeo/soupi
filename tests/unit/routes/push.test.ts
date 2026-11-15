import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prismaMock } from '../../mocks/prisma';

// Route-level tests for /push and /timers: the real Express app with Clerk, the
// database and the push services mocked out.
vi.mock('@clerk/express', () => ({
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    getAuth: () => ({ userId: 'user_1' }),
}));
vi.mock('../../../prisma/index', () => ({ default: prismaMock }));
vi.mock('../../../src/services/scraper', () => ({ scrapeRecipe: vi.fn() }));
const state = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../src/services/push-sender', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../src/services/push-sender')>();
    return {
        ...real,
        getPublicKey: () => (state.enabled ? 'BPUBLIC' : null),
        get pushEnabled() {
            return state.enabled;
        },
    };
});
vi.mock('../../../src/services/push', () => ({
    deleteSubscription: vi.fn(),
    deleteTimer: vi.fn(),
    listTimers: vi.fn(async () => []),
    MAX_TIMERS: 20,
    upsertSubscription: vi.fn(async () => ({ id: 7 })),
    upsertTimer: vi.fn(),
}));

const { default: app } = await import('../../../src/app');
const push = await import('../../../src/services/push');

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
    state.enabled = true;
    vi.mocked(push.upsertSubscription).mockClear();
    vi.mocked(push.upsertTimer).mockReset();
    vi.mocked(push.deleteTimer).mockClear();
});

const call = (method: string, path: string, body?: object) =>
    fetch(`${base}${path}`, {
        body: body ? JSON.stringify(body) : undefined,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'test-agent' },
        method,
    });

const ID = '0b6c5a3e-1d2f-4c4b-9a7e-2f1e3d4c5b6a';
const sub = { endpoint: 'https://web.push.apple.com/x', keys: { auth: 'a', p256dh: 'p' } };
const timerBody = {
    detail: 'chili',
    label: 'step 3',
    recipeId: 12,
    remainingMs: 60_000,
    subscriptionId: 7,
};

describe('/push', () => {
    it('GET /push/config returns the public key, or null when push is off', async () => {
        expect(await (await call('GET', '/push/config')).json()).toEqual({ publicKey: 'BPUBLIC' });
        state.enabled = false;
        expect(await (await call('GET', '/push/config')).json()).toEqual({ publicKey: null });
    });

    it('PUT /push/subscription registers the device', async () => {
        const res = await call('PUT', '/push/subscription', sub);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: 7 });
        expect(push.upsertSubscription).toHaveBeenCalledWith('user_1', sub, 'test-agent');
    });

    it('PUT /push/subscription rejects endpoints that are not push services', async () => {
        const res = await call('PUT', '/push/subscription', {
            ...sub,
            endpoint: 'https://soupi_prod_db/',
        });
        expect(res.status).toBe(400);
        expect(push.upsertSubscription).not.toHaveBeenCalled();
    });

    it('PUT /push/subscription replies 503 when push is off', async () => {
        state.enabled = false;
        expect((await call('PUT', '/push/subscription', sub)).status).toBe(503);
    });

    it('DELETE /push/subscription removes it', async () => {
        const res = await call('DELETE', '/push/subscription', { endpoint: sub.endpoint });
        expect(res.status).toBe(204);
        expect(push.deleteSubscription).toHaveBeenCalledWith('user_1', sub.endpoint);
    });
});

describe('/timers', () => {
    it('GET /timers needs a subscriptionId', async () => {
        expect((await call('GET', '/timers')).status).toBe(400);
        expect((await call('GET', '/timers?subscriptionId=7')).status).toBe(200);
        expect(push.listTimers).toHaveBeenCalledWith('user_1', 7);
    });

    it('PUT /timers/:id schedules the alert', async () => {
        vi.mocked(push.upsertTimer).mockResolvedValue({ timer: { id: ID } } as never);

        const res = await call('PUT', `/timers/${ID}`, timerBody);

        expect(res.status).toBe(200);
        expect(push.upsertTimer).toHaveBeenCalledWith('user_1', ID, timerBody);
    });

    it.each([
        ['too-many', 429],
        ['no-subscription', 404],
        ['not-found', 404],
    ])('PUT /timers/:id maps %s to %i', async (error, status) => {
        vi.mocked(push.upsertTimer).mockResolvedValue({ error } as never);
        expect((await call('PUT', `/timers/${ID}`, timerBody)).status).toBe(status);
    });

    it('PUT /timers/:id validates the id and body', async () => {
        expect((await call('PUT', '/timers/not-a-uuid', timerBody)).status).toBe(400);
        expect(
            (await call('PUT', `/timers/${ID}`, { ...timerBody, remainingMs: 500 })).status,
        ).toBe(400);
        expect(
            (await call('PUT', `/timers/${ID}`, { ...timerBody, remainingMs: 25 * 3600 * 1000 }))
                .status,
        ).toBe(400);
        expect(
            (await call('PUT', `/timers/${ID}`, { ...timerBody, label: 'x'.repeat(81) })).status,
        ).toBe(400);
        expect(push.upsertTimer).not.toHaveBeenCalled();
    });

    it('PUT /timers/:id replies 503 when push is off', async () => {
        state.enabled = false;
        expect((await call('PUT', `/timers/${ID}`, timerBody)).status).toBe(503);
    });

    it('DELETE /timers/:id cancels it', async () => {
        const res = await call('DELETE', `/timers/${ID}`);
        expect(res.status).toBe(204);
        expect(push.deleteTimer).toHaveBeenCalledWith('user_1', ID);
    });
});
