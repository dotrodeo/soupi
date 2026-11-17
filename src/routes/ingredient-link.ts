import { Router } from 'express';
import { z } from 'zod';

import { handle, parseBody } from '../middleware/handle';
import requireAuth from '../middleware/require-auth';
import { withHousehold } from '../middleware/with-household';
import { UpsertIngredientLinkSchema } from '../schemas';
import * as linkService from '../services/ingredient-link';

const router = Router();
const prefix = '/household/:householdId/ingredient-links';

router.get(
    prefix,
    requireAuth(),
    withHousehold(),
    handle((req) => linkService.listLinks(req.household.id)),
);

router.put(
    prefix,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const body = parseBody(res, UpsertIngredientLinkSchema, req.body);
        if (!body) return;
        return linkService.upsertLink(req.household.id, body);
    }),
);

router.delete(
    `${prefix}/:id`,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const id = z.coerce.number().int().positive().safeParse(req.params.id);
        if (!id.success) {
            res.status(400).json({ error: 'Invalid id' });
            return;
        }
        return linkService.deleteLink(req.household.id, id.data);
    }),
);

export default router;
