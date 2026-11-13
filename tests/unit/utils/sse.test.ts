import type { Response } from 'express';

import { vi } from 'vitest';

import { SSEMessageType } from '../../../utils/constants';

/** A fake Express response that keeps its mock types. */
function mockRes<T extends object>(res: T) {
    return res as Response & T;
}

describe('sse utils', () => {
    let addClient: typeof import('../../../utils/sse').addClient;
    let broadcast: typeof import('../../../utils/sse').broadcast;
    let clientsByHousehold: typeof import('../../../utils/sse').clientsByHousehold;

    beforeEach(async () => {
        vi.resetModules();
        ({ addClient, broadcast, clientsByHousehold } = await import('../../../utils/sse'));
    });

    describe('addClient()', () => {
        it('registers a client for a household', () => {
            const res = mockRes({ on: vi.fn(), write: vi.fn() });

            addClient(1, res);

            expect(clientsByHousehold.get(1)).toContain(res);
        });

        it('appends to existing clients for the same household', () => {
            const res1 = mockRes({ on: vi.fn(), write: vi.fn() });
            const res2 = mockRes({ on: vi.fn(), write: vi.fn() });

            addClient(1, res1);
            addClient(1, res2);

            expect(clientsByHousehold.get(1)).toHaveLength(2);
        });

        it('removes the client when connection closes', () => {
            let closeHandler: () => void;
            const res = mockRes({
                on: vi.fn((event: string, cb: () => void) => {
                    if (event === 'close') closeHandler = cb;
                }),
                write: vi.fn(),
            });

            addClient(1, res);
            expect(clientsByHousehold.get(1)).toContain(res);

            closeHandler!();
            expect(clientsByHousehold.get(1)).not.toContain(res);
        });
    });

    describe('broadcast()', () => {
        it('calls the callback and returns its result', async () => {
            const data = { id: 1, name: 'Test' };
            const cb = vi.fn().mockResolvedValue(data);

            const result = await broadcast(1, SSEMessageType.RECIPE_UPDATE, 'test', cb);

            expect(cb).toHaveBeenCalledOnce();
            expect(result).toEqual(data);
        });

        it('writes SSE message to all connected clients', async () => {
            const res1 = mockRes({ on: vi.fn(), write: vi.fn() });
            const res2 = mockRes({ on: vi.fn(), write: vi.fn() });
            addClient(2, res1);
            addClient(2, res2);

            await broadcast(2, SSEMessageType.RECIPE_UPDATE, 'test', async () => ({ ok: true }));

            expect(res1.write).toHaveBeenCalledOnce();
            expect(res2.write).toHaveBeenCalledOnce();
            expect(res1.write).toHaveBeenCalledWith(
                expect.stringContaining('"type":"recipe_update"'),
            );
        });

        it('sends no messages when no clients are connected', async () => {
            await expect(
                broadcast(999, SSEMessageType.RECIPE_UPDATE, 'test', async () => 'ok'),
            ).resolves.toBe('ok');
        });
    });
});
