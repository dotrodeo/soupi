import { getAuth } from '@clerk/express';
import { Router } from 'express';

import { handle, parseBody } from '../middleware/handle';
import requireAuth from '../middleware/require-auth';
import { DeletePushSubscriptionSchema, PushSubscriptionSchema } from '../schemas';
import * as pushService from '../services/push';
import { getPublicKey, isPushEndpoint, pushEnabled } from '../services/push-sender';

const router = Router();

/** The VAPID public key for PushManager.subscribe(), or null when push is off. */
router.get(
    '/config',
    requireAuth(),
    handle(() => ({ publicKey: getPublicKey() })),
);

router.put(
    '/subscription',
    requireAuth(),
    handle(async (req, res) => {
        if (!pushEnabled) {
            res.status(503).json({ error: 'Push is not configured' });
            return;
        }
        const body = parseBody(res, PushSubscriptionSchema, req.body);
        if (!body) return;
        if (!isPushEndpoint(body.endpoint)) {
            res.status(400).json({ error: 'Not a push service endpoint' });
            return;
        }
        return pushService.upsertSubscription(
            getAuth(req).userId!,
            body,
            req.get('user-agent')?.slice(0, 300),
        );
    }),
);

router.delete(
    '/subscription',
    requireAuth(),
    handle(async (req, res) => {
        const body = parseBody(res, DeletePushSubscriptionSchema, req.body);
        if (!body) return;
        await pushService.deleteSubscription(getAuth(req).userId!, body.endpoint);
    }),
);

export default router;
