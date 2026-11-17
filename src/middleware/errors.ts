import { Prisma } from '@prisma/client';

/** Thrown by services for an id that doesn't exist or isn't the caller's
 *  (another household's): handle() replies 404, so the two look the same. */
export class NotFoundError extends Error {
    constructor(message = 'Not found') {
        super(message);
        this.name = 'NotFoundError';
    }
}

/** A NotFoundError, or Prisma's "record not found" (P2025) from a scoped
 *  findUniqueOrThrow / findFirstOrThrow / update / delete. */
export function isNotFound(error: unknown): boolean {
    return (
        error instanceof NotFoundError ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
    );
}
