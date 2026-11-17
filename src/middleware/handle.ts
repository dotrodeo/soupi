import { Request, Response } from 'express';
import he from 'he';
import { z } from 'zod';

import logger from '../../utils/logger';
import { isNotFound } from './errors';

export function handle(fn: (req: Request, res: Response) => unknown) {
    return async (req: Request, res: Response) => {
        try {
            const result = await fn(req, res);

            // The handler already sent its own response (e.g. parseBody's 400).
            if (res.headersSent) return;

            // Void handlers (delete, connect/disconnect, etc.) resolve to
            // undefined — reply 204 so the client isn't left hanging until it
            // times out.
            if (result === undefined) {
                res.status(204).end();
                return;
            }

            if (typeof result !== 'object' || result === null) {
                res.status(200).send(result);
                return;
            }

            res.json(decodeEntitiesDeep(result));
        } catch (error) {
            // A missing id, or another household's (scoped queries don't find it).
            if (isNotFound(error)) {
                res.status(404).json({
                    error:
                        error instanceof Error && error.name === 'NotFoundError'
                            ? error.message
                            : 'Not found',
                });
                return;
            }
            logger.error({ err: error }, 'Route error');
            res.status(500).json(
                error instanceof Error
                    ? { error: error.message }
                    : { error: 'An unknown error occurred' },
            );
        }
    };
}

export function parseBody<T>(res: Response, schema: z.ZodType<T>, body: unknown): null | T {
    const result = schema.safeParse(body);
    if (!result.success) {
        res.status(400).json({
            details: result.error.flatten(),
            error: 'Invalid request body',
        });
        return null;
    }
    return result.data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeEntitiesDeep(value: any): any {
    if (typeof value === 'string') {
        return he.decode(value);
    } else if (Array.isArray(value)) {
        return value.map(decodeEntitiesDeep);
    } else if (value && typeof value === 'object' && !(value instanceof Date)) {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, decodeEntitiesDeep(v)]),
        );
    }
    return value;
}
