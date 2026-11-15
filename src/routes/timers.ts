import { getAuth } from '@clerk/express';
import { Router } from 'express';
import { z } from 'zod';

import { handle, parseBody } from '../middleware/handle';
import requireAuth from '../middleware/require-auth';
import { TimerIdSchema, UpsertTimerSchema } from '../schemas';
import * as pushService from '../services/push';
import { pushEnabled } from '../services/push-sender';

// Timer alerts (sous-web#22): a device tells soupi about its running timers so a
// push can alert it when one ends while the app is closed.
const router = Router();

const SubscriptionQuery = z.coerce.number().int().positive();

router.get(
    '/',
    requireAuth(),
    handle(async (req, res) => {
        const subscriptionId = SubscriptionQuery.safeParse(req.query.subscriptionId);
        if (!subscriptionId.success) {
            res.status(400).json({ error: 'subscriptionId is required' });
            return;
        }
        return pushService.listTimers(getAuth(req).userId!, subscriptionId.data);
    }),
);

router.put(
    '/:id',
    requireAuth(),
    handle(async (req, res) => {
        if (!pushEnabled) {
            res.status(503).json({ error: 'Push is not configured' });
            return;
        }
        const id = TimerIdSchema.safeParse(req.params.id);
        if (!id.success) {
            res.status(400).json({ error: 'Timer id must be a UUID' });
            return;
        }
        const body = parseBody(res, UpsertTimerSchema, req.body);
        if (!body) return;

        const result = await pushService.upsertTimer(getAuth(req).userId!, id.data, body);
        if ('timer' in result) return result.timer;
        if (result.error === 'too-many') {
            res.status(429).json({ error: `At most ${pushService.MAX_TIMERS} timers` });
        } else if (result.error === 'no-subscription') {
            res.status(404).json({ error: 'Push subscription not found' });
        } else {
            res.status(404).json({ error: 'Timer not found' });
        }
    }),
);

router.delete(
    '/:id',
    requireAuth(),
    handle(async (req, res) => {
        const id = TimerIdSchema.safeParse(req.params.id);
        if (!id.success) {
            res.status(400).json({ error: 'Timer id must be a UUID' });
            return;
        }
        await pushService.deleteTimer(getAuth(req).userId!, id.data);
    }),
);

export default router;
