import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prismaMock } from '../../mocks/prisma';

vi.mock('../../../prisma/index', () => ({ default: prismaMock }));
const { arm, disarm } = vi.hoisted(() => ({ arm: vi.fn(), disarm: vi.fn() }));
vi.mock('../../../src/services/timer-scheduler', () => ({ arm, disarm }));

const { deleteSubscription, deleteTimer, listTimers, MAX_TIMERS, upsertSubscription, upsertTimer } =
    await import('../../../src/services/push');

const ID = '0b6c5a3e-1d2f-4c4b-9a7e-2f1e3d4c5b6a';
const keys = { auth: 'a', p256dh: 'p' };
const endpoint = 'https://web.push.apple.com/x';
const body = {
    detail: 'chili',
    label: 'step 3',
    recipeId: 12,
    remainingMs: 60_000,
    subscriptionId: 7,
};

beforeEach(() => {
    arm.mockReset();
    disarm.mockReset();
});

describe('upsertSubscription()', () => {
    it('creates or updates by endpoint for the user', async () => {
        prismaMock.pushSubscription.findUnique.mockResolvedValue(null);
        prismaMock.pushSubscription.upsert.mockResolvedValue({ id: 7 } as never);

        expect(await upsertSubscription('user_1', { endpoint, keys }, 'Safari')).toEqual({ id: 7 });
        expect(prismaMock.pushSubscription.upsert).toHaveBeenCalledWith({
            create: { auth: 'a', endpoint, p256dh: 'p', userAgent: 'Safari', userId: 'user_1' },
            update: { auth: 'a', p256dh: 'p', userAgent: 'Safari', userId: 'user_1' },
            where: { endpoint },
        });
        expect(prismaMock.timerAlert.deleteMany).not.toHaveBeenCalled();
    });

    it("drops the previous user's timers when a browser switches accounts", async () => {
        prismaMock.pushSubscription.findUnique.mockResolvedValue({
            id: 7,
            timers: [{ id: 't1' }],
            userId: 'user_2',
        } as never);
        prismaMock.pushSubscription.upsert.mockResolvedValue({ id: 7 } as never);

        await upsertSubscription('user_1', { endpoint, keys });

        expect(disarm).toHaveBeenCalledWith('t1');
        expect(prismaMock.timerAlert.deleteMany).toHaveBeenCalledWith({
            where: { subscriptionId: 7 },
        });
    });
});

describe('deleteSubscription()', () => {
    it("removes only the user's own subscription, disarming its timers", async () => {
        prismaMock.pushSubscription.findFirst.mockResolvedValue({
            id: 7,
            timers: [{ id: 't1' }],
        } as never);

        await deleteSubscription('user_1', endpoint);

        expect(prismaMock.pushSubscription.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { endpoint, userId: 'user_1' } }),
        );
        expect(disarm).toHaveBeenCalledWith('t1');
        expect(prismaMock.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    });

    it('does nothing for an unknown endpoint', async () => {
        prismaMock.pushSubscription.findFirst.mockResolvedValue(null);
        await deleteSubscription('user_1', endpoint);
        expect(prismaMock.pushSubscription.delete).not.toHaveBeenCalled();
    });
});

describe('listTimers()', () => {
    it("lists the device's timers for this user, with time left", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-15T18:00:00Z'));
        prismaMock.timerAlert.findMany.mockResolvedValue([
            {
                detail: 'chili',
                endsAt: new Date('2026-11-15T18:01:00Z'),
                id: ID,
                label: 'step 3',
                recipeId: 12,
            },
        ] as never);

        const timers = await listTimers('user_1', 7);

        expect(prismaMock.timerAlert.findMany).toHaveBeenCalledWith({
            orderBy: { endsAt: 'asc' },
            where: { subscription: { userId: 'user_1' }, subscriptionId: 7 },
        });
        expect(timers[0].remainingMs).toBe(60_000);
        vi.useRealTimers();
    });
});

describe('upsertTimer()', () => {
    it("refuses a subscription that isn't the user's", async () => {
        prismaMock.pushSubscription.findFirst.mockResolvedValue(null);

        expect(await upsertTimer('user_1', ID, body)).toEqual({ error: 'no-subscription' });
        expect(prismaMock.pushSubscription.findFirst).toHaveBeenCalledWith({
            where: { id: 7, userId: 'user_1' },
        });
        expect(arm).not.toHaveBeenCalled();
    });

    it("never overwrites another user's timer with the same id", async () => {
        prismaMock.pushSubscription.findFirst.mockResolvedValue({ id: 7 } as never);
        prismaMock.timerAlert.findUnique.mockResolvedValue({
            subscription: { userId: 'user_2' },
        } as never);

        expect(await upsertTimer('user_1', ID, body)).toEqual({ error: 'not-found' });
        expect(prismaMock.timerAlert.upsert).not.toHaveBeenCalled();
    });

    it(`caps new timers at ${MAX_TIMERS} per user`, async () => {
        prismaMock.pushSubscription.findFirst.mockResolvedValue({ id: 7 } as never);
        prismaMock.timerAlert.findUnique.mockResolvedValue(null);
        prismaMock.timerAlert.count.mockResolvedValue(MAX_TIMERS);

        expect(await upsertTimer('user_1', ID, body)).toEqual({ error: 'too-many' });
    });

    it('computes the end time from the time left, saves and arms it', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-15T18:00:00Z'));
        prismaMock.pushSubscription.findFirst.mockResolvedValue({ id: 7 } as never);
        prismaMock.timerAlert.findUnique.mockResolvedValue(null);
        prismaMock.timerAlert.count.mockResolvedValue(0);
        const saved = {
            detail: 'chili',
            endsAt: new Date('2026-11-15T18:01:00Z'),
            id: ID,
            label: 'step 3',
            recipeId: 12,
        };
        prismaMock.timerAlert.upsert.mockResolvedValue(saved as never);

        const result = await upsertTimer('user_1', ID, body);

        const data = {
            detail: 'chili',
            endsAt: saved.endsAt,
            label: 'step 3',
            recipeId: 12,
            subscriptionId: 7,
        };
        expect(prismaMock.timerAlert.upsert).toHaveBeenCalledWith({
            create: { id: ID, ...data },
            update: data,
            where: { id: ID },
        });
        expect(arm).toHaveBeenCalledWith(saved);
        expect(result).toEqual({ timer: { ...saved, remainingMs: 60_000 } });
        vi.useRealTimers();
    });

    it('rescheduling an existing timer skips the cap', async () => {
        prismaMock.pushSubscription.findFirst.mockResolvedValue({ id: 7 } as never);
        prismaMock.timerAlert.findUnique.mockResolvedValue({
            subscription: { userId: 'user_1' },
        } as never);
        prismaMock.timerAlert.upsert.mockResolvedValue({ endsAt: new Date(), id: ID } as never);

        await upsertTimer('user_1', ID, body);

        expect(prismaMock.timerAlert.count).not.toHaveBeenCalled();
        expect(arm).toHaveBeenCalled();
    });
});

describe('deleteTimer()', () => {
    it("deletes only the user's timer and disarms it", async () => {
        prismaMock.timerAlert.deleteMany.mockResolvedValue({ count: 1 });

        await deleteTimer('user_1', ID);

        expect(prismaMock.timerAlert.deleteMany).toHaveBeenCalledWith({
            where: { id: ID, subscription: { userId: 'user_1' } },
        });
        expect(disarm).toHaveBeenCalledWith(ID);
    });

    it("leaves another user's timer armed", async () => {
        prismaMock.timerAlert.deleteMany.mockResolvedValue({ count: 0 });
        await deleteTimer('user_1', ID);
        expect(disarm).not.toHaveBeenCalled();
    });
});
