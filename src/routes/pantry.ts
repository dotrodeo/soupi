import { Router } from 'express';

import { handle, parseBody } from '../middleware/handle';
import requireAuth from '../middleware/require-auth';
import { withHousehold } from '../middleware/with-household';
import { UpsertPantryItemSchema } from '../schemas';
import * as pantryService from '../services/pantry';

const router = Router();
const prefix = '/household/:householdId/pantry';

router.get(
    prefix,
    requireAuth(),
    withHousehold(),
    handle((req) => pantryService.getPantries(req.household.id)),
);

router.post(
    `${prefix}/:pantryId`,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const body = parseBody(res, UpsertPantryItemSchema, req.body);
        if (!body) return;
        return pantryService.upsertPantryItem(req.household.id, {
            pantryId: Number(req.params.pantryId),
            ...body,
        });
    }),
);

router.get(
    `${prefix}/:pantryId/items`,
    requireAuth(),
    withHousehold(),
    handle((req) => pantryService.getAllPantryItems(req.household.id, Number(req.params.pantryId))),
);

router.get(
    `${prefix}/:pantryId/items/:itemId`,
    requireAuth(),
    withHousehold(),
    handle((req) =>
        pantryService.getPantryItem(
            req.household.id,
            Number(req.params.pantryId),
            Number(req.params.itemId),
        ),
    ),
);

router.delete(
    `${prefix}/:pantryId/items/:itemId`,
    requireAuth(),
    withHousehold(),
    handle(async (req, res) => {
        const deleted = await pantryService.deletePantryItem(
            req.household.id,
            Number(req.params.pantryId),
            Number(req.params.itemId),
        );
        if (!deleted) res.status(404).json({ error: 'Pantry item not found' });
    }),
);

export default router;
