import { Router } from 'express';

import logger from '../../utils/logger';
import { handle, parseBody } from '../middleware/handle';
import requireAuth from '../middleware/require-auth';
import { withHousehold } from '../middleware/with-household';
import { CompleteRecipeSchema, UpsertRecipeSchema } from '../schemas';
import * as recipeService from '../services/recipe';
import { RecipeJSON, scrapeRecipe } from '../services/scraper';

const router = Router();
const prefix = '/household/:householdId/recipes';

router.get(
    prefix,
    requireAuth(),
    withHousehold(),
    handle((req) => {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
        return recipeService.getAllRecipes(req.household.id, { limit, page });
    }),
);

router.post(
    prefix,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const body = parseBody(res, UpsertRecipeSchema, req.body);
        if (!body) return;
        return recipeService.upsertRecipe(req.household.id, body);
    }),
);

router.post(
    `${prefix}/from-url`,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const queryUrl = req.query.url as string | undefined;
        if (!queryUrl) {
            res.status(400).json({ error: 'url query parameter is required' });
            return;
        }
        let url: string;
        try {
            url = decodeURIComponent(queryUrl);
        } catch (_e) {
            url = queryUrl;
        }
        return recipeService.createRecipeFromUrl(req.household.id, url);
    }),
);

router.get(
    `${prefix}/tags`,
    requireAuth(),
    withHousehold(),
    handle((req) => recipeService.getAllRecipeTags(req.household.id)),
);

router.get(`${prefix}/scrape`, requireAuth(), withHousehold(), async (req, res) => {
    try {
        const { url } = req.query;
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'Missing url param' });
        }
        const recipe: null | RecipeJSON = await scrapeRecipe(url);
        res.json(recipe);
    } catch (err) {
        logger.error({ err }, 'Failed to scrape recipe');
        res.status(500).json({ error: 'Failed to scrape recipe' });
    }
});

router.get(
    `${prefix}/:id`,
    requireAuth(),
    withHousehold(),
    handle((req) => recipeService.getRecipe(req.household.id, Number(req.params.id))),
);

router.delete(
    `${prefix}/:id`,
    requireAuth(),
    withHousehold(),
    handle((req) => recipeService.deleteRecipe(req.household.id, Number(req.params.id))),
);

router.post(
    `${prefix}/:id/made`,
    requireAuth(),
    withHousehold(),
    handle((req, res) => {
        const body = parseBody(res, CompleteRecipeSchema, req.body);
        if (!body) return;
        return recipeService.completeRecipe(req.household.id, body);
    }),
);

export default router;
