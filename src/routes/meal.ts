// Planned meals that aren't recipes (sous-web#67).
import { Router } from 'express';

import { handle, parseBody } from '../middleware/handle';
import requireAuth from '../middleware/require-auth';
import { withHousehold } from '../middleware/with-household';
import { CompleteMealSchema, UpsertMealSchema } from '../schemas';
import * as mealService from '../services/meal';

const router = Router();
const prefix = '/household/:householdId/meals';

router.get(
    prefix,
    requireAuth(),
    withHousehold(),
    handle((req) => mealService.listMeals(req.household.id)),
);

router.post(
    prefix,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const body = parseBody(res, UpsertMealSchema, req.body);
        if (!body) return;
        return mealService.upsertMeal(req.household.id, body);
    }),
);

router.delete(
    `${prefix}/:id`,
    requireAuth(),
    withHousehold(),
    handle((req) => mealService.deleteMeal(req.household.id, Number(req.params.id))),
);

router.post(
    `${prefix}/:id/made`,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const body = parseBody(res, CompleteMealSchema, req.body);
        if (!body) return;
        return mealService.completeMeal(req.household.id, Number(req.params.id), body);
    }),
);

export default router;
