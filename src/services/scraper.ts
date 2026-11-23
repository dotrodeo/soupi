// Recipe import: load the page, then read the recipe with rules (structured data,
// then the post's headings, or a social caption). The AI model is only a fallback
// for what the rules can't read, and only when OPENAI_API_KEY is set.
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { type CheerioAPI, load } from 'cheerio';
import puppeteer from 'puppeteer';
import { z } from 'zod';

import logger from '../../utils/logger';
import { fromCaption } from './import/caption';
import {
    cleanText,
    formatDuration,
    isUsable,
    type ParsedRecipe,
    stripStepNumber,
} from './import/common';
import { fromHeadings, pageTitle, textLines } from './import/headings';
import { fromJsonLd, fromMicrodata } from './import/structured';

export type ImportMethod = 'ai' | 'caption' | 'headings' | 'json-ld' | 'microdata';

export interface RecipeJSON {
    cookTime: null | string;
    ingredients: string[];
    instructions: string[];
    name: null | string;
    /** Links kept from the page (the video, the full recipe) when the steps aren't written out. */
    notes: null | string;
    /** Indexes into `ingredients` of the optional ones (an "Optional:" section). */
    optionalIngredients: number[];
    prepTime: null | string;
    servings: null | string;
    source: null | string;
}

const SOCIAL_HOSTS = ['tiktok.com', 'instagram.com'];

/** Reads a recipe out of a page's HTML with rules only. Exported for tests. */
export function parsePage(
    html: string,
    url: string,
): null | { method: ImportMethod; recipe: ParsedRecipe } {
    const $ = load(html);
    if (isSocial(url)) {
        const recipe = fromCaption(caption($));
        return isUsable(recipe) ? { method: 'caption', recipe } : null;
    }
    const jsonLd = fromJsonLd($);
    if (isUsable(jsonLd)) return { method: 'json-ld', recipe: jsonLd };
    const microdata = fromMicrodata($);
    if (isUsable(microdata)) return { method: 'microdata', recipe: microdata };
    const headings = fromHeadings($, url);
    if (isUsable(headings)) return { method: 'headings', recipe: headings };
    return null;
}

export async function scrapeRecipe(
    url: string,
    { isRetry }: { isRetry?: boolean } = {},
): Promise<null | RecipeJSON> {
    const social = isSocial(url);
    const html = await loadPage(url, social);

    const parsed = parsePage(html, url);
    if (parsed) {
        logger.info({ method: parsed.method, url }, 'Recipe imported');
        return toRecipeJSON(parsed.recipe, url);
    }

    // Nothing the rules could read: the AI is the last resort, when configured.
    if (!process.env.OPENAI_API_KEY) {
        logger.info({ url }, 'Recipe import found no recipe (no AI fallback configured)');
        return null;
    }
    const $ = load(html);
    const text = social ? caption($) : textLines($('body')).join('\n').slice(0, 15000);
    if (!text) return null;
    const ai = await aiParse(text);
    if (!ai) return null;
    if (ai.recipe.ingredients.length === 0 && ai.externalLink && !isRetry) {
        return scrapeRecipe(ai.externalLink, { isRetry: true });
    }
    if (ai.recipe.ingredients.length === 0) return null;
    logger.info({ method: 'ai', url }, 'Recipe imported');
    return toRecipeJSON({ ...ai.recipe, name: ai.recipe.name ?? pageTitle($) }, url);
}

/** The AI fallback: text that might contain a recipe, read by an OpenAI model. */
async function aiParse(
    text: string,
): Promise<null | { externalLink?: string; recipe: ParsedRecipe }> {
    const parsed = await generateObject({
        model: openai('gpt-4o-mini'),
        prompt: `
            Parse the following text into a recipe and format it as JSON.
            Never under any circumstances should you hallucinate recipe details.
            Only include what you can confidently parse from the text.
            If you cannot find a field, simply omit it from the output.
            If you find a link to a recipe, return it in the externalLink field.
            If you're not confident about any field, omit it.
            The text may contain extraneous information, so only include relevant recipe details.

            Text to parse:
            ${text}
        `,
        schema: z.object({
            cookTime: z.string().optional(),
            externalLink: z.string().optional(),
            ingredients: z.array(z.string()),
            instructions: z.array(z.string()),
            name: z.string().optional(),
            prepTime: z.string().optional(),
            servings: z.string().optional(),
        }),
    });
    const object = parsed?.object;
    if (!object) return null;
    return {
        externalLink: object.externalLink,
        recipe: {
            cookTime: formatDuration(object.cookTime),
            ingredients: object.ingredients
                .map(cleanText)
                .filter(Boolean)
                .map((sentence) => ({ optional: false, sentence })),
            instructions: object.instructions
                .map((s) => stripStepNumber(cleanText(s)))
                .filter(Boolean),
            name: cleanText(object.name) || null,
            notes: null,
            prepTime: formatDuration(object.prepTime),
            servings: cleanText(object.servings) || null,
        },
    };
}

function caption($: CheerioAPI): string {
    return (
        $('meta[property="og:description"]').attr('content') ??
        $('meta[name="description"]').attr('content') ??
        ''
    );
}

function isSocial(url: string) {
    return SOCIAL_HOSTS.some((host) => url.toLowerCase().includes(host));
}

/** Loads a page in headless Chromium and returns its HTML after scripts ran. */
async function loadPage(url: string, social: boolean): Promise<string> {
    const browser = await puppeteer.launch({
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-gpu',
        ],
        headless: true,
    });
    try {
        const page = await browser.newPage();
        // Present as the regular Chrome it is: several big recipe sites refuse a
        // "HeadlessChrome" user agent (owner decision, soupi#32).
        await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        // Many recipe sites never go network-idle (ads); social and YouTube pages
        // aren't filled in until they do.
        const waitUntil =
            social || url.includes('youtube.com') ? 'networkidle2' : 'domcontentloaded';
        await page.goto(url, { timeout: 15000, waitUntil });
        return await page.content();
    } finally {
        await browser.close();
    }
}

function toRecipeJSON(recipe: ParsedRecipe, url: string): RecipeJSON {
    return {
        cookTime: recipe.cookTime,
        ingredients: recipe.ingredients.map((i) => i.sentence),
        instructions: recipe.instructions,
        name: recipe.name,
        notes: recipe.notes,
        optionalIngredients: recipe.ingredients.flatMap((i, n) => (i.optional ? [n] : [])),
        prepTime: recipe.prepTime,
        servings: recipe.servings,
        source: url,
    };
}
