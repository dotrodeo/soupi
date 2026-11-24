import { Router } from 'express';

import { handle, parseBody } from '../middleware/handle';
import requireAuth from '../middleware/require-auth';
import { withHousehold } from '../middleware/with-household';
import { AddMealsToPlanDaySchema, AddPlanDaySchema, AddRecipesToPlanDaySchema } from '../schemas';
import * as planService from '../services/plan';

const router = Router();
const prefix = '/household/:householdId/plan';

router.get(
    prefix,
    requireAuth(),
    withHousehold(),
    handle((req) => planService.getPlan(req.household.id)),
);

router.post(
    `${prefix}/day`,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const body = parseBody(res, AddPlanDaySchema, req.body);
        if (!body) return;
        return planService.addPlanDay(req.household.id, body);
    }),
);

router.delete(
    `${prefix}/day/:planDayId`,
    requireAuth(),
    withHousehold(),
    handle((req) => planService.removePlanDay(req.household.id, Number(req.params.planDayId))),
);

router.post(
    `${prefix}/day/:planDayId/recipes`,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const body = parseBody(res, AddRecipesToPlanDaySchema, req.body);
        if (!body) return;
        return planService.addRecipesToPlanDay(req.household.id, {
            planDayId: Number(req.params.planDayId),
            recipeIds: body,
        });
    }),
);

router.delete(
    `${prefix}/day/:planDayId/recipes/:recipeId`,
    requireAuth(),
    withHousehold(),
    handle((req) =>
        planService.removeRecipeFromPlanDay(req.household.id, {
            planDayId: Number(req.params.planDayId),
            recipeId: Number(req.params.recipeId),
        }),
    ),
);

router.post(
    `${prefix}/day/:planDayId/meals`,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const body = parseBody(res, AddMealsToPlanDaySchema, req.body);
        if (!body) return;
        return planService.addMealsToPlanDay(req.household.id, {
            mealIds: body,
            planDayId: Number(req.params.planDayId),
        });
    }),
);

router.delete(
    `${prefix}/day/:planDayId/meals/:mealId`,
    requireAuth(),
    withHousehold(),
    handle((req) =>
        planService.removeMealFromPlanDay(req.household.id, {
            mealId: Number(req.params.mealId),
            planDayId: Number(req.params.planDayId),
        }),
    ),
);

export default router;
