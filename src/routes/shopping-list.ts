import { Router } from 'express';

import { handle, parseBody } from '../middleware/handle';
import requireAuth from '../middleware/require-auth';
import { withHousehold } from '../middleware/with-household';
import { AddToShoppingListSchema } from '../schemas';
import * as shoppingListService from '../services/shopping-list';

const router = Router();
const prefix = '/household/:householdId/pantry/:pantryId/shopping-list';

router.get(
    prefix,
    requireAuth(),
    withHousehold(),
    handle((req) =>
        shoppingListService.getListByCategory(req.household.id, Number(req.params.pantryId)),
    ),
);

router.post(
    prefix,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const body = parseBody(res, AddToShoppingListSchema, req.body);
        if (!body) return;
        return shoppingListService.addToList(req.household.id, Number(req.params.pantryId), body);
    }),
);

export default router;
