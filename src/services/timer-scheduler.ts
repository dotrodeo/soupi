// Fires timer alerts (sous-web#22): one in-process timeout per pending timer,
// rebuilt from the database when the server starts. soupi runs one API instance
// per environment, so no locking is needed.
import { TimerAlert } from '@prisma/client';

import prisma from '../../prisma';
import logger from '../../utils/logger';
import { appLink, pushEnabled, sendPush } from './push-sender';

/** Fire this long after the end, so a page that rang the alarm itself has time
 *  to cancel the push first (no double alert). */
export const GRACE_MS = 2000;
/** On boot, alerts that came due while the server was down are still sent if at
 *  most this late; older ones are dropped. */
export const LATE_LIMIT_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [5000, 15000];

const armed = new Map<string, NodeJS.Timeout>();

export function alertPayload(
    timer: Pick<TimerAlert, 'detail' | 'id' | 'label' | 'recipeId'>,
    lateMs: number,
) {
    const minutesLate = Math.round(lateMs / 60000);
    return {
        // Declarative Web Push: Safari 18.4+ shows this without running any
        // service worker code; other browsers' workers read the same fields.
        notification: {
            body:
                minutesLate >= 1 ? `${timer.detail} · ended ${minutesLate} min ago` : timer.detail,
            navigate: appLink(timer.recipeId ? `/recipes/${timer.recipeId}` : '/'),
            tag: timer.id,
            title: `timer done: ${timer.label}`,
        },
        timerId: timer.id,
        web_push: 8030,
    };
}

export function arm(timer: Pick<TimerAlert, 'endsAt' | 'id'>, attempt = 0) {
    disarm(timer.id);
    const delay =
        attempt === 0
            ? Math.max(0, timer.endsAt.getTime() + GRACE_MS - Date.now())
            : RETRY_DELAYS_MS[attempt - 1];
    const handle = setTimeout(() => {
        armed.delete(timer.id);
        void fire(timer.id, timer.endsAt, attempt);
    }, delay);
    handle.unref?.();
    armed.set(timer.id, handle);
}

export function disarm(id: string) {
    const handle = armed.get(id);
    if (handle) clearTimeout(handle);
    armed.delete(id);
}

export function disarmAll() {
    armed.forEach((handle) => clearTimeout(handle));
    armed.clear();
}

/** Sends the alert for a timer if it still exists with this end time (it may
 *  have been cancelled or rescheduled since it was armed). */
export async function fire(id: string, endsAt: Date, attempt = 0) {
    try {
        const timer = await prisma.timerAlert.findFirst({
            include: { subscription: true },
            where: { endsAt, id },
        });
        if (!timer) return;

        const result = await sendPush(
            timer.subscription,
            alertPayload(timer, Date.now() - timer.endsAt.getTime()),
        );

        if (result === 'gone') {
            // The device unsubscribed or the browser dropped it; its timers go too.
            await prisma.pushSubscription.deleteMany({ where: { id: timer.subscriptionId } });
            return;
        }
        if (result === 'failed' && attempt < RETRY_DELAYS_MS.length) {
            arm(timer, attempt + 1);
            return;
        }
        await prisma.timerAlert.deleteMany({ where: { endsAt, id } });
        if (result === 'sent') {
            await prisma.pushSubscription.updateMany({
                data: { lastUsedAt: new Date() },
                where: { id: timer.subscriptionId },
            });
        }
    } catch (err) {
        logger.error({ err, timerId: id }, 'timer alert failed');
    }
}

export function isArmed(id: string): boolean {
    return armed.has(id);
}

/** Arms every pending timer; call once when the server starts. */
export async function startTimerScheduler() {
    if (!pushEnabled) return;
    const timers = await prisma.timerAlert.findMany({ select: { endsAt: true, id: true } });
    const cutoff = Date.now() - LATE_LIMIT_MS;
    const stale = timers.filter((t) => t.endsAt.getTime() < cutoff).map((t) => t.id);
    if (stale.length) await prisma.timerAlert.deleteMany({ where: { id: { in: stale } } });
    timers.filter((t) => t.endsAt.getTime() >= cutoff).forEach((t) => arm(t));
    logger.info(
        { armed: timers.length - stale.length, dropped: stale.length },
        'timer alerts armed',
    );
}
