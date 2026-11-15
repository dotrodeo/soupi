import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prismaMock } from '../../mocks/prisma';

vi.mock('../../../prisma/index', () => ({ default: prismaMock }));
const { sendPush } = vi.hoisted(() => ({ sendPush: vi.fn() }));
vi.mock('../../../src/services/push-sender', () => ({
    appLink: (path: string) => `https://sous.test${path}`,
    pushEnabled: true,
    sendPush,
}));

const {
    alertPayload,
    arm,
    disarmAll,
    fire,
    GRACE_MS,
    isArmed,
    LATE_LIMIT_MS,
    startTimerScheduler,
} = await import('../../../src/services/timer-scheduler');

const NOW = new Date('2026-11-15T18:00:00Z');
const sub = { auth: 'a', endpoint: 'https://web.push.apple.com/x', id: 7, p256dh: 'p' };
const timer = (over: object = {}) => ({
    createdAt: NOW,
    detail: 'weeknight chili',
    endsAt: new Date(NOW.getTime() + 60_000),
    id: '0b6c5a3e-1d2f-4c4b-9a7e-2f1e3d4c5b6a',
    label: 'step 3 · 25 min',
    recipeId: 12,
    subscription: sub,
    subscriptionId: 7,
    ...over,
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sendPush.mockReset();
    prismaMock.timerAlert.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.pushSubscription.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
});
afterEach(() => {
    disarmAll();
    vi.useRealTimers();
});

describe('alertPayload()', () => {
    it('is a declarative push that opens the recipe', () => {
        expect(alertPayload(timer(), 0)).toEqual({
            notification: {
                body: 'weeknight chili',
                navigate: 'https://sous.test/recipes/12',
                tag: timer().id,
                title: 'timer done: step 3 · 25 min',
            },
            timerId: timer().id,
            web_push: 8030,
        });
    });

    it('says how long ago a late alert ended, and opens the app without a recipe', () => {
        const p = alertPayload(timer({ recipeId: null }), 3 * 60_000);
        expect(p.notification.body).toBe('weeknight chili · ended 3 min ago');
        expect(p.notification.navigate).toBe('https://sous.test/');
    });
});

describe('arm()', () => {
    it('fires a grace period after the end time, not before', async () => {
        prismaMock.timerAlert.findFirst.mockResolvedValue(timer() as never);
        sendPush.mockResolvedValue('sent');

        arm(timer());
        await vi.advanceTimersByTimeAsync(60_000 + GRACE_MS - 1);
        expect(sendPush).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(sendPush).toHaveBeenCalledTimes(1);
        expect(isArmed(timer().id)).toBe(false);
    });

    it('re-arming replaces the earlier schedule', async () => {
        prismaMock.timerAlert.findFirst.mockResolvedValue(timer() as never);
        sendPush.mockResolvedValue('sent');

        arm(timer());
        arm(timer({ endsAt: new Date(NOW.getTime() + 120_000) }));
        await vi.advanceTimersByTimeAsync(60_000 + GRACE_MS);
        expect(sendPush).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendPush).toHaveBeenCalledTimes(1);
    });
});

describe('fire()', () => {
    it('sends, deletes the timer and marks the subscription used', async () => {
        const t = timer();
        prismaMock.timerAlert.findFirst.mockResolvedValue(t as never);
        sendPush.mockResolvedValue('sent');

        await fire(t.id, t.endsAt);

        expect(prismaMock.timerAlert.findFirst).toHaveBeenCalledWith({
            include: { subscription: true },
            where: { endsAt: t.endsAt, id: t.id },
        });
        expect(sendPush).toHaveBeenCalledWith(sub, alertPayload(t, -60_000));
        expect(prismaMock.timerAlert.deleteMany).toHaveBeenCalledWith({
            where: { endsAt: t.endsAt, id: t.id },
        });
        expect(prismaMock.pushSubscription.updateMany).toHaveBeenCalledWith({
            data: { lastUsedAt: expect.any(Date) },
            where: { id: 7 },
        });
    });

    it('does nothing for a timer that was cancelled or rescheduled', async () => {
        prismaMock.timerAlert.findFirst.mockResolvedValue(null);

        await fire(timer().id, timer().endsAt);

        expect(sendPush).not.toHaveBeenCalled();
    });

    it('drops a subscription the push service says is gone', async () => {
        prismaMock.timerAlert.findFirst.mockResolvedValue(timer() as never);
        sendPush.mockResolvedValue('gone');

        await fire(timer().id, timer().endsAt);

        expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 7 } });
    });

    it('retries a failed send twice, then gives up', async () => {
        const t = timer();
        prismaMock.timerAlert.findFirst.mockResolvedValue(t as never);
        sendPush.mockResolvedValue('failed');

        await fire(t.id, t.endsAt);
        expect(isArmed(t.id)).toBe(true);
        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(15000);

        expect(sendPush).toHaveBeenCalledTimes(3);
        expect(isArmed(t.id)).toBe(false);
        expect(prismaMock.timerAlert.deleteMany).toHaveBeenCalledTimes(1);
        expect(prismaMock.pushSubscription.updateMany).not.toHaveBeenCalled();
    });
});

describe('startTimerScheduler()', () => {
    it('arms recent timers and drops ones that ended too long ago', async () => {
        const fresh = { endsAt: new Date(NOW.getTime() + 60_000), id: 'fresh' };
        const missed = { endsAt: new Date(NOW.getTime() - 60_000), id: 'missed' };
        const stale = { endsAt: new Date(NOW.getTime() - LATE_LIMIT_MS - 1), id: 'stale' };
        prismaMock.timerAlert.findMany.mockResolvedValue([fresh, missed, stale] as never);

        await startTimerScheduler();

        expect(prismaMock.timerAlert.deleteMany).toHaveBeenCalledWith({
            where: { id: { in: ['stale'] } },
        });
        expect([isArmed('fresh'), isArmed('missed'), isArmed('stale')]).toEqual([
            true,
            true,
            false,
        ]);
    });
});
