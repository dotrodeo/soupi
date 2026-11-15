import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('web-push', () => ({ default: { sendNotification, setVapidDetails: vi.fn() } }));

const { isPushEndpoint, sendPush } = await import('../../../src/services/push-sender');

describe('isPushEndpoint()', () => {
    it.each([
        'https://fcm.googleapis.com/fcm/send/abc',
        'https://web.push.apple.com/QF8abc',
        'https://updates.push.services.mozilla.com/wpush/v2/abc',
        'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ])('accepts %s', (url) => {
        expect(isPushEndpoint(url)).toBe(true);
    });

    it.each([
        'http://fcm.googleapis.com/fcm/send/abc', // not https
        'https://soupi_prod_db:5432/', // internal host
        'https://127.0.0.1/',
        'https://evilpush.apple.com/', // suffix without a dot boundary
        'https://push.apple.com.evil.com/', // look-alike
        'https://fcm.googleapis.com.evil.com/',
        'not a url',
    ])('rejects %s', (url) => {
        expect(isPushEndpoint(url)).toBe(false);
    });
});

describe('sendPush()', () => {
    const target = { auth: 'a', endpoint: 'https://web.push.apple.com/x', p256dh: 'p' };

    beforeEach(() => {
        sendNotification.mockReset();
    });

    it('sends with a short TTL and high urgency', async () => {
        sendNotification.mockResolvedValue({ statusCode: 201 });

        expect(await sendPush(target, { a: 1 })).toBe('sent');
        expect(sendNotification).toHaveBeenCalledWith(
            { endpoint: target.endpoint, keys: { auth: 'a', p256dh: 'p' } },
            '{"a":1}',
            { TTL: 300, urgency: 'high' },
        );
    });

    it.each([404, 410])('reports %i as gone', async (statusCode) => {
        sendNotification.mockImplementation(async () => {
            throw Object.assign(new Error('gone'), { statusCode });
        });
        expect(await sendPush(target, {})).toBe('gone');
    });

    it('reports other errors as failed', async () => {
        sendNotification.mockImplementation(async () => {
            throw Object.assign(new Error('unavailable'), { statusCode: 503 });
        });
        expect(await sendPush(target, {})).toBe('failed');
    });
});
