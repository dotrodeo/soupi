import type { Request, Response } from 'express';

import { vi } from 'vitest';

import { prismaMock } from '../../mocks/prisma';

vi.mock('../../../prisma', () => ({ default: prismaMock }));
vi.mock('@clerk/express', () => ({
    getAuth: vi.fn().mockReturnValue({ userId: 'user_123' }),
}));

import { getAuth } from '@clerk/express';

import { withHousehold } from '../../../src/middleware/with-household';

const mockHousehold = { id: 1, name: 'My Household' } as never;

function mockReqRes(params: Record<string, string> = {}) {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const req = { household: undefined, params, userId: undefined } as unknown as Request;
    const resMock = { json, status };
    const res = resMock as Response & typeof resMock;
    const next = vi.fn();
    return { next, req, res };
}

describe('withHousehold()', () => {
    it('returns 400 when householdId is not a number', async () => {
        const { next, req, res } = mockReqRes({ householdId: 'abc' });

        await withHousehold()(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.status().json).toHaveBeenCalledWith({ error: 'Invalid householdId parameter' });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when no userId in auth', async () => {
        vi.mocked(getAuth).mockReturnValueOnce({ userId: null } as never);
        const { next, req, res } = mockReqRes({ householdId: '1' });

        await withHousehold()(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when user does not have access to household', async () => {
        prismaMock.household.findFirst.mockResolvedValue(null);
        const { next, req, res } = mockReqRes({ householdId: '1' });

        await withHousehold()(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('attaches household and userId to req then calls next', async () => {
        prismaMock.household.findFirst.mockResolvedValue(mockHousehold);
        const { next, req, res } = mockReqRes({ householdId: '1' });

        await withHousehold()(req, res, next);

        expect(req.household).toEqual(mockHousehold);
        expect(req.userId).toBe('user_123');
        expect(next).toHaveBeenCalledOnce();
    });

    it('queries without member check when skipAccessCheck is true', async () => {
        prismaMock.household.findFirst.mockResolvedValue(mockHousehold);
        const { next, req, res } = mockReqRes({ householdId: '1' });

        await withHousehold(true)(req, res, next);

        expect(prismaMock.household.findFirst).toHaveBeenCalledWith({
            where: { id: 1 },
        });
        expect(next).toHaveBeenCalledOnce();
    });

    it('queries with member check when skipAccessCheck is false (default)', async () => {
        prismaMock.household.findFirst.mockResolvedValue(mockHousehold);
        const { next, req, res } = mockReqRes({ householdId: '1' });

        await withHousehold()(req, res, next);

        expect(prismaMock.household.findFirst).toHaveBeenCalledWith({
            where: { id: 1, members: { some: { id: 'user_123' } } },
        });
    });
});
