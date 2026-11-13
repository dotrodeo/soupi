import type { User } from '@prisma/client';

import { vi } from 'vitest';

import { prismaMock } from '../../mocks/prisma';
import '../../mocks/broadcast';

vi.mock('../../../prisma', () => ({ default: prismaMock }));
vi.mock('../../../utils/sse');

const { createUser, getById, sync, updateUser } = await import('../../../src/services/user');

const mockClerkUser = {
    emailAddresses: [{ emailAddress: 'alice@example.com' }],
    fullName: 'Alice Smith',
    id: 'user_123',
} as never;

const mockDbUser: User & { households: { id: number; name: string }[] } = {
    clerkId: 'user_123',
    createdAt: new Date('2024-01-01'),
    defaultHouseholdId: 1,
    deletedAt: null,
    email: 'alice@example.com',
    households: [{ id: 1, name: 'My Household' }],
    id: 'user_123',
    name: 'Alice Smith',
    themePreference: 'system',
    updatedAt: new Date('2024-01-01'),
};

describe('createUser()', () => {
    it('creates user with household and pantry in a transaction', async () => {
        prismaMock.$transaction.mockImplementation(async (cb) => cb(prismaMock));
        prismaMock.user.create.mockResolvedValue({
            ...mockDbUser,
            households: [{ id: 1 }],
        } as never);
        prismaMock.user.update.mockResolvedValue(mockDbUser);

        const result = await createUser(mockClerkUser);

        expect(prismaMock.user.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    clerkId: 'user_123',
                    email: 'alice@example.com',
                    name: 'Alice Smith',
                }),
            }),
        );
        expect(prismaMock.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { defaultHouseholdId: 1 },
            }),
        );
        expect(result).toEqual(mockDbUser);
    });
});

describe('getById()', () => {
    it('returns user with households', async () => {
        prismaMock.user.findUnique.mockResolvedValue(mockDbUser);

        const result = await getById('user_123');

        expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'user_123' } }),
        );
        expect(result).toEqual(mockDbUser);
    });

    it('returns null when user not found', async () => {
        prismaMock.user.findUnique.mockResolvedValue(null);

        expect(await getById('missing')).toBeNull();
    });
});

describe('sync()', () => {
    it('creates a new user when they do not exist in DB', async () => {
        prismaMock.user.findUnique.mockResolvedValue(null);
        prismaMock.$transaction.mockImplementation(async (cb) => cb(prismaMock));
        prismaMock.user.create.mockResolvedValue({
            ...mockDbUser,
            households: [{ id: 1 }],
        } as never);
        prismaMock.user.update.mockResolvedValue(mockDbUser);

        const result = await sync(mockClerkUser);

        expect(prismaMock.user.create).toHaveBeenCalledOnce();
        expect(result).toEqual(mockDbUser);
    });

    it('updates an existing user', async () => {
        prismaMock.user.findUnique.mockResolvedValue(mockDbUser);
        prismaMock.user.update.mockResolvedValue(mockDbUser);

        const result = await sync(mockClerkUser);

        expect(prismaMock.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ email: 'alice@example.com' }),
                where: { id: 'user_123' },
            }),
        );
        expect(result).toEqual(mockDbUser);
    });
});

describe('updateUser()', () => {
    it('throws when trying to update defaultHouseholdId directly', async () => {
        prismaMock.user.findUnique.mockResolvedValue(mockDbUser);

        await expect(updateUser('user_123', { defaultHouseholdId: 2 } as never)).rejects.toThrow(
            'Use `householdService.joinHousehold`',
        );
    });

    it('throws when trying to update clerkId', async () => {
        prismaMock.user.findUnique.mockResolvedValue(mockDbUser);

        await expect(updateUser('user_123', { clerkId: 'new_id' } as never)).rejects.toThrow(
            'Use `userService.sync`',
        );
    });

    it('throws when trying to update email directly', async () => {
        prismaMock.user.findUnique.mockResolvedValue(mockDbUser);

        await expect(updateUser('user_123', { email: 'new@email.com' } as never)).rejects.toThrow(
            'Use `userService.sync`',
        );
    });

    it('updates allowed fields successfully', async () => {
        prismaMock.user.findUnique.mockResolvedValue(mockDbUser);
        prismaMock.user.update.mockResolvedValue(mockDbUser);

        const result = await updateUser('user_123', {} as never);

        expect(prismaMock.user.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'user_123' } }),
        );
        expect(result).toEqual(mockDbUser);
    });
});
