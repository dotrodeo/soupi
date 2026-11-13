import type { Request, Response } from 'express';

import { vi } from 'vitest';

import { prismaMock } from '../../mocks/prisma';

vi.mock('@clerk/express', () => ({ getAuth: vi.fn() }));
vi.mock('../../../prisma', () => ({ default: prismaMock }));

import { getAuth } from '@clerk/express';

import requireAuth from '../../../src/middleware/require-auth';

const getAuthMock = vi.mocked(getAuth);

function mockReqRes() {
    const req = {} as Request;
    const resMock = {
        json: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
    };
    const res = resMock as Response & typeof resMock;
    const next = vi.fn();
    return { next, req, res };
}

describe('requireAuth()', () => {
    it('calls next() when user is authenticated', () => {
        getAuthMock.mockReturnValue({ userId: 'user_123' } as never);
        const { next, req, res } = mockReqRes();

        requireAuth()(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 401 when userId is null', () => {
        getAuthMock.mockReturnValue({ userId: null } as never);
        const { next, req, res } = mockReqRes();

        requireAuth()(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when userId is undefined', () => {
        getAuthMock.mockReturnValue({ userId: undefined } as never);
        const { next, req, res } = mockReqRes();

        requireAuth()(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
});
