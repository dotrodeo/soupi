// Recipes from a page's structured data: schema.org JSON-LD, then microdata.
import type { CheerioAPI } from 'cheerio';

import {
    cleanText,
    formatDuration,
    formatYield,
    type ParsedRecipe,
    stripStepNumber,
} from './common';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isRecipe = (node: Json) => {
    const type = node['@type'];
    return (Array.isArray(type) ? type : [type]).some(
        (t) => typeof t === 'string' && /(^|[/:])Recipe$/.test(t),
    );
};

/** The first schema.org Recipe in the page's JSON-LD, if any. */
export function fromJsonLd($: CheerioAPI): null | ParsedRecipe {
    for (const el of $('script[type="application/ld+json"]').toArray()) {
        let doc: unknown;
        try {
            // Some sites leave raw control characters in strings; JSON.parse rejects them.
            const text = $(el).text();
            // eslint-disable-next-line no-control-regex
            doc = JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '));
        } catch {
            continue;
        }
        for (const node of walk(doc)) {
            if (!isRecipe(node)) continue;
            const ingredients = ingredientsFrom(node.recipeIngredient ?? node.ingredients);
            if (ingredients.length === 0) continue;
            return {
                cookTime: formatDuration(node.cookTime),
                ingredients: ingredients.map((sentence) => ({ optional: false, sentence })),
                instructions: instructionsFrom(node.recipeInstructions),
                name: cleanText(node.name) || null,
                notes: null,
                prepTime: formatDuration(node.prepTime),
                servings: formatYield(node.recipeYield),
            };
        }
    }
    return null;
}

/** A schema.org Recipe marked up with itemprop attributes (older sites). */
export function fromMicrodata($: CheerioAPI): null | ParsedRecipe {
    const root = $('[itemtype*="schema.org/Recipe"]').first();
    if (root.length === 0) return null;
    const prop = (name: string) => root.find(`[itemprop="${name}"]`);
    const value = (name: string) => {
        const el = prop(name).first();
        return el.attr('content') ?? el.attr('datetime') ?? el.text();
    };

    const ingredients = [...prop('recipeIngredient').toArray(), ...prop('ingredients').toArray()]
        .map((el) => cleanText($(el).text()))
        .filter(Boolean);
    if (ingredients.length === 0) return null;

    const instructions = prop('recipeInstructions')
        .toArray()
        .flatMap((el) => {
            const items = $(el).find('li, p').toArray();
            const parts = items.length ? items.map((i) => $(i).html() ?? '') : [$(el).html() ?? ''];
            return parts.flatMap((html) => instructionsFrom(html));
        });

    return {
        cookTime: formatDuration(value('cookTime')),
        ingredients: ingredients.map((sentence) => ({ optional: false, sentence })),
        instructions,
        name: cleanText(value('name')) || null,
        notes: null,
        prepTime: formatDuration(value('prepTime')),
        servings: formatYield(value('recipeYield')),
    };
}

function ingredientsFrom(value: unknown): string[] {
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split('\n') : [];
    return list.map(cleanText).filter(Boolean);
}

/** recipeInstructions: a string, HowToStep(s), or HowToSection(s) of steps. */
function instructionsFrom(value: unknown, depth = 0): string[] {
    if (depth > 5 || value == null) return [];
    if (typeof value === 'string') {
        // One block of text: a step per line (or per <br>/<p>), else the whole thing.
        return value
            .split(/<br\s*\/?>|<\/p>|\n+/i)
            .map((line) => stripStepNumber(cleanText(line)))
            .filter(Boolean);
    }
    if (Array.isArray(value)) return value.flatMap((v) => instructionsFrom(v, depth + 1));
    if (isObject(value)) {
        if (value.itemListElement) return instructionsFrom(value.itemListElement, depth + 1);
        const text = cleanText(value.text ?? value.name ?? value.description);
        return text ? [stripStepNumber(text)] : [];
    }
    return [];
}

/** Every object in a JSON-LD document, depth first (@graph, mainEntity, lists…). */
function* walk(value: unknown, depth = 0): Generator<Json> {
    if (depth > 8) return;
    if (Array.isArray(value)) {
        for (const item of value) yield* walk(item, depth + 1);
    } else if (isObject(value)) {
        yield value;
        for (const child of Object.values(value)) yield* walk(child, depth + 1);
    }
}
