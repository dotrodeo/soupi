// Push subscriptions (one per browser per device) and the timer alerts each
// device has pending (sous-web#22).
import prisma from '../../prisma';
import { arm, disarm } from './timer-scheduler';

/** At most this many pending timers per user, across their devices. */
export const MAX_TIMERS = 20;

export interface TimerView {
    detail: string;
    endsAt: Date;
    id: string;
    label: string;
    recipeId: null | number;
    /** Time left by the server's clock; clients compute their own end time from it. */
    remainingMs: number;
}

const view = (t: {
    detail: string;
    endsAt: Date;
    id: string;
    label: string;
    recipeId: null | number;
}): TimerView => ({
    detail: t.detail,
    endsAt: t.endsAt,
    id: t.id,
    label: t.label,
    recipeId: t.recipeId,
    remainingMs: Math.max(0, t.endsAt.getTime() - Date.now()),
});

export type UpsertTimerResult =
    | { error: 'no-subscription' | 'not-found' | 'too-many' }
    | { timer: TimerView };

/** Removes the user's subscription for this endpoint, and its timers. */
export async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
    const sub = await prisma.pushSubscription.findFirst({
        include: { timers: { select: { id: true } } },
        where: { endpoint, userId },
    });
    if (!sub) return;
    sub.timers.forEach((t) => disarm(t.id));
    await prisma.pushSubscription.delete({ where: { id: sub.id } });
}

/** Cancels one of the user's timers. Already sent or unknown: nothing to do. */
export async function deleteTimer(userId: string, id: string): Promise<void> {
    const { count } = await prisma.timerAlert.deleteMany({
        where: { id, subscription: { userId } },
    });
    if (count) disarm(id);
}

/** This device's pending timers, soonest first. */
export async function listTimers(userId: string, subscriptionId: number): Promise<TimerView[]> {
    const timers = await prisma.timerAlert.findMany({
        orderBy: { endsAt: 'asc' },
        where: { subscription: { userId }, subscriptionId },
    });
    return timers.map(view);
}

/** Registers this device for the user. A browser that switches accounts keeps its
 *  endpoint, so the subscription moves to the new user and the old user's timers
 *  on it are dropped. */
export async function upsertSubscription(
    userId: string,
    sub: { endpoint: string; keys: { auth: string; p256dh: string } },
    userAgent?: string,
): Promise<{ id: number }> {
    const existing = await prisma.pushSubscription.findUnique({
        include: { timers: { select: { id: true } } },
        where: { endpoint: sub.endpoint },
    });
    if (existing && existing.userId !== userId) {
        existing.timers.forEach((t) => disarm(t.id));
        await prisma.timerAlert.deleteMany({ where: { subscriptionId: existing.id } });
    }
    const data = { auth: sub.keys.auth, p256dh: sub.keys.p256dh, userAgent, userId };
    const saved = await prisma.pushSubscription.upsert({
        create: { endpoint: sub.endpoint, ...data },
        update: data,
        where: { endpoint: sub.endpoint },
    });
    return { id: saved.id };
}

/** Creates or reschedules a timer alert on one of the user's devices. */
export async function upsertTimer(
    userId: string,
    id: string,
    body: {
        detail: string;
        label: string;
        recipeId?: null | number;
        remainingMs: number;
        subscriptionId: number;
    },
): Promise<UpsertTimerResult> {
    const sub = await prisma.pushSubscription.findFirst({
        where: { id: body.subscriptionId, userId },
    });
    if (!sub) return { error: 'no-subscription' };

    // Timer ids are client UUIDs; never let one user overwrite another's.
    const existing = await prisma.timerAlert.findUnique({
        include: { subscription: { select: { userId: true } } },
        where: { id },
    });
    if (existing && existing.subscription.userId !== userId) return { error: 'not-found' };

    if (!existing) {
        const pending = await prisma.timerAlert.count({ where: { subscription: { userId } } });
        if (pending >= MAX_TIMERS) return { error: 'too-many' };
    }

    const data = {
        detail: body.detail,
        endsAt: new Date(Date.now() + body.remainingMs),
        label: body.label,
        recipeId: body.recipeId ?? null,
        subscriptionId: sub.id,
    };
    const timer = await prisma.timerAlert.upsert({
        create: { id, ...data },
        update: data,
        where: { id },
    });
    arm(timer);
    return { timer: view(timer) };
}
