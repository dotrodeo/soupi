// Sends web pushes for timer alerts (sous-web#22) with VAPID. Push is on only
// when APP_URL, VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are all set.
import webpush from 'web-push';

import logger from '../../utils/logger';

const appUrl = process.env.APP_URL?.replace(/\/+$/, '');
const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;

export const pushEnabled = Boolean(appUrl && publicKey && privateKey);

if (pushEnabled) {
    // A URL subject rather than mailto:, so no personal email goes to push services.
    webpush.setVapidDetails(appUrl!, publicKey!, privateKey!);
} else if (publicKey || privateKey) {
    logger.warn('Web push is off: APP_URL, VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are all needed');
}

export function appLink(path: string): string {
    return `${appUrl ?? ''}${path}`;
}

export function getPublicKey(): null | string {
    return pushEnabled ? publicKey! : null;
}

// soupi POSTs to whatever endpoint a client registers, so accept only the push
// services' own hosts; otherwise a member could aim requests at internal hosts.
const PUSH_HOSTS = [
    /^fcm\.googleapis\.com$/,
    /(^|\.)push\.apple\.com$/,
    /(^|\.)push\.services\.mozilla\.com$/,
    /(^|\.)notify\.windows\.com$/,
];

export interface PushTarget {
    auth: string;
    endpoint: string;
    p256dh: string;
}

/** `gone`: the push service says the subscription no longer exists (404/410). */
export type SendResult = 'failed' | 'gone' | 'sent';

export function isPushEndpoint(endpoint: string): boolean {
    try {
        const url = new URL(endpoint);
        return url.protocol === 'https:' && PUSH_HOSTS.some((h) => h.test(url.hostname));
    } catch {
        return false;
    }
}

export async function sendPush(target: PushTarget, payload: object): Promise<SendResult> {
    const host = new URL(target.endpoint).hostname;
    const started = Date.now();
    try {
        const res = await webpush.sendNotification(
            { endpoint: target.endpoint, keys: { auth: target.auth, p256dh: target.p256dh } },
            JSON.stringify(payload),
            // An alert more than five minutes late is no use to anyone cooking.
            { TTL: 300, urgency: 'high' },
        );
        logger.info({ host, ms: Date.now() - started, status: res.statusCode }, 'push sent');
        return 'sent';
    } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        const gone = status === 404 || status === 410;
        logger.warn(
            { body: (err as { body?: string }).body, host, ms: Date.now() - started, status },
            gone ? 'push subscription gone' : 'push failed',
        );
        return gone ? 'gone' : 'failed';
    }
}
