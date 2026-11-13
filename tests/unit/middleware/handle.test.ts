import type { Request, Response } from 'express';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { prismaMock } from '../../mocks/prisma';

vi.mock('../../../prisma', () => ({ default: prismaMock }));
vi.mock('../../../utils/logger', () => ({
    default: { error: vi.fn(), info: vi.fn() },
}));

import { handle, parseBody } from '../../../src/middleware/handle';

function mockReqRes(params: Record<string, string> = {}) {
    const json = vi.fn();
    const send = vi.fn();
    const end = vi.fn();
    const status = vi.fn().mockReturnValue({ end, json, send });
    const req = { params } as unknown as Request;
    const resMock = { end, headersSent: false, json, send, status };
    const res = resMock as Response & typeof resMock;
    return { req, res };
}

const SimpleSchema = z.object({
    age: z.number().int().positive(),
    name: z.string().min(1),
});

describe('parseBody()', () => {
    it('returns parsed data when body is valid', () => {
        const { res } = mockReqRes();
        const result = parseBody(res, SimpleSchema, { age: 30, name: 'Alice' });
        expect(result).toEqual({ age: 30, name: 'Alice' });
        expect(res.status).not.toHaveBeenCalled();
    });

    it('returns null and sends 400 when body is invalid', () => {
        const { res } = mockReqRes();
        const result = parseBody(res, SimpleSchema, { name: '' });
        expect(result).toBeNull();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.status().json).toHaveBeenCalledWith(
            expect.objectContaining({ details: expect.any(Object), error: 'Invalid request body' }),
        );
    });

    it('returns null when body is completely wrong type', () => {
        const { res } = mockReqRes();
        const result = parseBody(res, SimpleSchema, null);
        expect(result).toBeNull();
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('includes Zod flatten details in 400 response', () => {
        const { res } = mockReqRes();
        parseBody(res, SimpleSchema, { age: -5, name: 'Alice' });
        const call = res.status().json.mock.calls[0][0];
        expect(call.details).toHaveProperty('fieldErrors');
    });
});

describe('handle()', () => {
    it('calls fn and returns JSON result', async () => {
        const { req, res } = mockReqRes();
        const handler = handle(vi.fn().mockResolvedValue({ id: 1, name: 'Test' }));

        await handler(req, res);

        expect(res.json).toHaveBeenCalledWith({ id: 1, name: 'Test' });
    });

    it('sends plain text for non-object return values', async () => {
        const { req, res } = mockReqRes();
        const handler = handle(vi.fn().mockResolvedValue('plain text'));

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.status().send).toHaveBeenCalledWith('plain text');
    });

    it('sends 204 when fn returns undefined', async () => {
        const { req, res } = mockReqRes();
        const handler = handle(vi.fn().mockResolvedValue(undefined));

        await handler(req, res);

        expect(res.json).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(204);
        expect(res.status().end).toHaveBeenCalled();
    });

    it('does not double-respond when the handler already sent a response', async () => {
        const { req, res } = mockReqRes();
        (res as { headersSent: boolean }).headersSent = true;
        const handler = handle(vi.fn().mockResolvedValue(undefined));

        await handler(req, res);

        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });

    it('returns 500 with error message when fn throws an Error', async () => {
        const { req, res } = mockReqRes();
        const handler = handle(vi.fn().mockRejectedValue(new Error('Something went wrong')));

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.status().json).toHaveBeenCalledWith({ error: 'Something went wrong' });
    });

    it('returns 500 with fallback message for non-Error throws', async () => {
        const { req, res } = mockReqRes();
        const handler = handle(vi.fn().mockRejectedValue('raw string error'));

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.status().json).toHaveBeenCalledWith({ error: 'An unknown error occurred' });
    });

    it('HTML-decodes entity strings in response', async () => {
        const { req, res } = mockReqRes();
        const handler = handle(vi.fn().mockResolvedValue({ name: 'Caf&eacute;' }));

        await handler(req, res);

        expect(res.json).toHaveBeenCalledWith({ name: 'Café' });
    });
});
