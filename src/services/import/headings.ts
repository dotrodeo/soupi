// Recipes from pages without structured data (blogs such as Blogger posts): the
// post body's "Ingredients…" and "Directions" sections, read as lines.
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

import { cleanText, type ParsedRecipe } from './common';
import { readRecipeLines } from './lines';

/** Where a post's text usually is, most specific first. */
const BODY_SELECTORS = [
    '[itemprop="articleBody"]',
    '.post-body',
    '.entry-content',
    '.post-content',
    'article',
    'main',
    'body',
];

/** A recipe from the post body's headings, if it has an ingredients list. */
export function fromHeadings($: CheerioAPI, pageUrl: string): null | ParsedRecipe {
    for (const selector of BODY_SELECTORS) {
        const root = $(selector).first();
        if (root.length === 0) continue;
        const { ingredients, instructions } = readRecipeLines(textLines(root));
        // Two lines under an "Ingredients" heading, so a stray mention doesn't count.
        if (ingredients.length < 2) continue;
        return {
            cookTime: null,
            ingredients,
            instructions,
            name: pageTitle($),
            notes: instructions.length === 0 ? linkNotes($, root, pageUrl) : null,
            prepTime: null,
            servings: null,
        };
    }
    return null;
}

/** The page's title: og:title, then the first h1, then <title>. */
export function pageTitle($: CheerioAPI): null | string {
    return (
        cleanText($('meta[property="og:title"]').attr('content')) ||
        cleanText($('h1').first().text()) ||
        cleanText($('title').text()) ||
        null
    );
}

/** An element's text as lines, breaking where the browser would (br, p, li…). */
export function textLines(root: Cheerio<AnyNode>): string[] {
    const html = (root.html() ?? '')
        .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(
            /<\/?(?:p|div|li|ul|ol|h[1-6]|tr|table|section|article|blockquote|header|footer)\b[^>]*>/gi,
            '\n',
        );
    return html
        .split('\n')
        .map((line) => cleanText(line))
        .filter(Boolean);
}

/** Links worth keeping when the steps aren't written out: the video, the full recipe. */
function linkNotes($: CheerioAPI, root: Cheerio<AnyNode>, pageUrl: string): null | string {
    const notes: string[] = [];
    const videoIds = new Set<string>();
    $('iframe[src]')
        .toArray()
        .forEach((el) => {
            const id = /youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/.exec(
                $(el).attr('src') ?? '',
            )?.[1];
            if (id) videoIds.add(id);
        });
    videoIds.forEach((id) => notes.push(`Video: https://www.youtube.com/watch?v=${id}`));

    let pageHost = '';
    try {
        pageHost = new URL(pageUrl).hostname;
    } catch {
        // a bad URL just means every link counts as elsewhere
    }
    const recipeLink = root
        .find('a[href]')
        .toArray()
        .map((el) => ({ href: $(el).attr('href') ?? '', text: cleanText($(el).text()) }))
        .find(({ href, text }) => {
            if (!/recipe/i.test(text) || !/^https?:\/\//i.test(href)) return false;
            try {
                return new URL(href).hostname !== pageHost;
            } catch {
                return false;
            }
        });
    if (recipeLink) notes.push(`Full recipe: ${recipeLink.href}`);
    return notes.length ? notes.join('\n') : null;
}
