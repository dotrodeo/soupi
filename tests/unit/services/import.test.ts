import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';

import { captionText, fromCaption } from '../../../src/services/import/caption';
import { formatDuration, formatYield, stripStepNumber } from '../../../src/services/import/common';
import { fromHeadings } from '../../../src/services/import/headings';
import { readRecipeLines } from '../../../src/services/import/lines';
import { fromJsonLd, fromMicrodata } from '../../../src/services/import/structured';
import { parsePage } from '../../../src/services/scraper';

const page = (body: string, head = '') =>
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const jsonLd = (doc: unknown) =>
    `<script type="application/ld+json">${JSON.stringify(doc)}</script>`;
const names = (list: { sentence: string }[]) => list.map((i) => i.sentence);

describe('formatDuration()', () => {
    it('reads schema.org durations', () => {
        expect(formatDuration('PT45M')).toBe('45 mins');
        expect(formatDuration('PT1H30M')).toBe('1 hour 30 mins');
        expect(formatDuration('PT2H')).toBe('2 hours');
        expect(formatDuration('PT90M')).toBe('1 hour 30 mins');
        expect(formatDuration('P0DT0H20M')).toBe('20 mins');
        expect(formatDuration('PT1M')).toBe('1 min');
    });
    it('treats zero and empty as no time', () => {
        expect(formatDuration('PT0M')).toBeNull();
        expect(formatDuration('')).toBeNull();
        expect(formatDuration(undefined)).toBeNull();
    });
    it('keeps text that is not a duration', () => {
        expect(formatDuration('about 20 minutes')).toBe('about 20 minutes');
    });
});

describe('formatYield() and stripStepNumber()', () => {
    it('prefers the wordier yield', () => {
        expect(formatYield(['4', '4 servings'])).toBe('4 servings');
        expect(formatYield(6)).toBe('6');
        expect(formatYield(null)).toBeNull();
    });
    it('drops step numbering', () => {
        expect(stripStepNumber('1. Mix.')).toBe('Mix.');
        expect(stripStepNumber('Step 2: Bake.')).toBe('Bake.');
        expect(stripStepNumber('3) Serve.')).toBe('Serve.');
        expect(stripStepNumber('350 degrees')).toBe('350 degrees');
    });
});

describe('fromJsonLd()', () => {
    const recipe = {
        '@type': ['Recipe', 'NewsArticle'],
        cookTime: 'PT1H',
        name: 'Chili &amp; Beans',
        prepTime: 'PT15M',
        recipeIngredient: ['1 lb beans', ' 2  onions ', ''],
        recipeInstructions: [
            {
                '@type': 'HowToSection',
                itemListElement: [
                    { '@type': 'HowToStep', text: 'Soak the beans.' },
                    { '@type': 'HowToStep', text: '<p>Chop the <b>onions</b>.</p>' },
                ],
                name: 'Prep',
            },
            { '@type': 'HowToStep', name: 'Simmer for an hour.' },
        ],
        recipeYield: ['6', '6 servings'],
    };

    it('finds a recipe inside @graph, with sections of steps', () => {
        const $ = load(
            page(
                jsonLd({
                    '@context': 'https://schema.org',
                    '@graph': [{ '@type': 'WebPage' }, recipe],
                }),
            ),
        );
        expect(fromJsonLd($)).toEqual({
            cookTime: '1 hour',
            ingredients: [
                { optional: false, sentence: '1 lb beans' },
                { optional: false, sentence: '2 onions' },
            ],
            instructions: ['Soak the beans.', 'Chop the onions.', 'Simmer for an hour.'],
            name: 'Chili & Beans',
            notes: null,
            prepTime: '15 mins',
            servings: '6 servings',
        });
    });
    it('skips broken blocks and non-recipes', () => {
        const html = page(
            '<script type="application/ld+json">{ not json</script>' +
                jsonLd({ '@type': 'Organization', name: 'Site' }) +
                jsonLd([{ ...recipe, '@type': 'Recipe' }]),
        );
        expect(fromJsonLd(load(html))?.name).toBe('Chili & Beans');
    });
    it('splits a single block of instructions into steps', () => {
        const html = page(
            jsonLd({
                '@type': 'Recipe',
                name: 'Toast',
                recipeIngredient: ['bread'],
                recipeInstructions: '1. Toast the bread.<br>2. Butter it.',
            }),
        );
        expect(fromJsonLd(load(html))?.instructions).toEqual(['Toast the bread.', 'Butter it.']);
    });
    it('returns null without a recipe that has ingredients', () => {
        expect(fromJsonLd(load(page(jsonLd({ '@type': 'Recipe', name: 'Empty' }))))).toBeNull();
        expect(fromJsonLd(load(page('<p>hi</p>')))).toBeNull();
    });
});

describe('fromMicrodata()', () => {
    it('reads itemprop markup', () => {
        const html = page(`
            <div itemscope itemtype="http://schema.org/Recipe">
                <h1 itemprop="name">Pancakes</h1>
                <meta itemprop="prepTime" content="PT10M">
                <span itemprop="recipeYield">8 pancakes</span>
                <ul><li itemprop="recipeIngredient">2 cups flour</li><li itemprop="ingredients">2 eggs</li></ul>
                <div itemprop="recipeInstructions"><ol><li>Whisk everything.</li><li>Fry in butter.</li></ol></div>
            </div>`);
        expect(fromMicrodata(load(html))).toEqual({
            cookTime: null,
            ingredients: [
                { optional: false, sentence: '2 cups flour' },
                { optional: false, sentence: '2 eggs' },
            ],
            instructions: ['Whisk everything.', 'Fry in butter.'],
            name: 'Pancakes',
            notes: null,
            prepTime: '10 mins',
            servings: '8 pancakes',
        });
    });
});

describe('fromHeadings()', () => {
    // Shaped like a Blogger post: prose, then <br>-separated lines, an "Optional:"
    // section, a link to the full recipe and an embedded video. Source line breaks
    // inside an ingredient are just whitespace.
    const blog = page(
        `<div class="post-body entry-content">
            <p>The first time I had this salad it was the texture that surprised me. Anyway, this is easy.</p>
            <iframe src="https://www.youtube.com/embed/AbC123xyz?rel=0"></iframe>
            <br>Ingredients for 2 large servings:
            <br>1 package rice noodles (soaked in almost
            boiling water, drained)
            <br>3 garlic cloves, crushed
            <br>For the dressing:
            <br>3 tbsp fish sauce
            <br>Optional:
            <br>6 grilled chicken thighs
            <br>sliced Fresno chilies
            <br><a href="http://example.org/recipe/salad">View the complete recipe</a>
        </div>`,
        '<meta property="og:title" content="Spicy Rice Noodle Salad">',
    );

    it('reads the ingredients under the heading, with optional ones marked', () => {
        const recipe = fromHeadings(load(blog), 'https://blog.example.com/salad.html');
        expect(recipe?.name).toBe('Spicy Rice Noodle Salad');
        expect(recipe?.ingredients).toEqual([
            {
                optional: false,
                sentence: '1 package rice noodles (soaked in almost boiling water, drained)',
            },
            { optional: false, sentence: '3 garlic cloves, crushed' },
            { optional: false, sentence: '3 tbsp fish sauce' },
            { optional: true, sentence: '6 grilled chicken thighs' },
            { optional: true, sentence: 'sliced Fresno chilies' },
        ]);
        expect(recipe?.instructions).toEqual([]);
    });
    it('keeps the video and full-recipe links in the notes when there are no steps', () => {
        const recipe = fromHeadings(load(blog), 'https://blog.example.com/salad.html');
        expect(recipe?.notes).toBe(
            'Video: https://www.youtube.com/watch?v=AbC123xyz\nFull recipe: http://example.org/recipe/salad',
        );
    });
    it('reads written steps under a directions heading, and then needs no notes', () => {
        const html = page(`<article>
            <h2>Ingredients</h2><ul><li>2 cups flour</li><li>1 cup milk</li></ul>
            <h2>Directions</h2><ol><li>Mix the flour and milk.</li><li>Bake for 20 minutes.</li></ol>
            <p>Notes</p><p>Keeps for a week in the fridge.</p>
            <iframe src="https://www.youtube.com/embed/zzz999zzz"></iframe>
        </article>`);
        const recipe = fromHeadings(load(html), 'https://example.com/x');
        expect(names(recipe!.ingredients)).toEqual(['2 cups flour', '1 cup milk']);
        expect(recipe?.instructions).toEqual(['Mix the flour and milk.', 'Bake for 20 minutes.']);
        expect(recipe?.notes).toBeNull();
    });
    it('needs at least two lines under an ingredients heading', () => {
        expect(
            fromHeadings(
                load(page('<p>The ingredients are simple.</p><p>Flour.</p>')),
                'https://x.com',
            ),
        ).toBeNull();
        expect(
            fromHeadings(load(page('<p>Ingredients:</p><p>2 eggs</p>')), 'https://x.com'),
        ).toBeNull();
    });
});

describe('readRecipeLines()', () => {
    it('stops the ingredient list at a paragraph of prose', () => {
        const prose = 'This is a long paragraph. '.repeat(10);
        const { ingredients } = readRecipeLines([
            'Ingredients:',
            '2 eggs',
            '1 cup milk',
            prose,
            '3 apples',
        ]);
        expect(names(ingredients)).toEqual(['2 eggs', '1 cup milk']);
    });
    it('drops bullets and emoji', () => {
        const { ingredients } = readRecipeLines([
            'Ingredients',
            '- 2 eggs',
            '• 1 cup milk',
            '🧄 3 garlic cloves',
        ]);
        expect(names(ingredients)).toEqual(['2 eggs', '1 cup milk', '3 garlic cloves']);
    });
});

describe('fromCaption()', () => {
    it('unwraps an Instagram description', () => {
        expect(
            captionText(
                '1,234 likes, 56 comments - cook on May 1, 2026: "Best soup\nIngredients:". ',
            ),
        ).toBe('Best soup\nIngredients:');
        expect(captionText('Just a caption')).toBe('Just a caption');
    });
    it('reads a caption with headings', () => {
        const recipe = fromCaption(
            '10 likes - cook on May 1: "Garlic Butter Noodles 🍜\n\nIngredients:\n• 8 oz noodles\n• 4 tbsp butter\n• 6 garlic cloves\n\nInstructions:\n1. Boil the noodles.\n2. Melt butter with garlic.\n3. Toss together.\n\n#pasta #easyrecipes". ',
        );
        expect(recipe?.name).toBe('Garlic Butter Noodles 🍜');
        expect(names(recipe!.ingredients)).toEqual([
            '8 oz noodles',
            '4 tbsp butter',
            '6 garlic cloves',
        ]);
        expect(recipe?.instructions).toEqual([
            'Boil the noodles.',
            'Melt butter with garlic.',
            'Toss together.',
        ]);
    });
    it('guesses from the shape of the lines when there are no headings', () => {
        const recipe = fromCaption(
            'Quick lemon pasta!\n200g spaghetti\n1 lemon, zested\n½ cup parmesan\n1. Cook the pasta.\n2. Toss with lemon and cheese.\nSo good!!',
        );
        expect(recipe?.name).toBe('Quick lemon pasta');
        expect(names(recipe!.ingredients)).toEqual([
            '200g spaghetti',
            '1 lemon, zested',
            '½ cup parmesan',
        ]);
        expect(recipe?.instructions).toEqual(['Cook the pasta.', 'Toss with lemon and cheese.']);
    });
    it('splits a run-on caption at bullets and step numbers', () => {
        const recipe = fromCaption(
            'Ingredients: - 2 eggs - 1 cup milk - 1 cup flour Method: 1. Whisk. 2. Fry in a hot pan until golden.',
        );
        expect(names(recipe!.ingredients)).toEqual(['2 eggs', '1 cup milk', '1 cup flour']);
        expect(recipe?.instructions).toEqual(['Whisk.', 'Fry in a hot pan until golden.']);
    });
    it('gives up on a chatty caption', () => {
        expect(
            fromCaption(
                'Made my grandma’s soup today, just throw in whatever veggies you have and simmer! ❤️',
            ),
        ).toBeNull();
        expect(fromCaption('')).toBeNull();
    });
});

describe('parsePage()', () => {
    it('prefers structured data over headings', () => {
        const html = page(
            jsonLd({ '@type': 'Recipe', name: 'From JSON', recipeIngredient: ['1 egg'] }) +
                '<article><p>Ingredients:</p><p>2 eggs</p><p>1 cup milk</p></article>',
        );
        expect(parsePage(html, 'https://example.com/r')).toMatchObject({
            method: 'json-ld',
            recipe: { name: 'From JSON' },
        });
    });
    it('falls back to headings', () => {
        const html = page('<article><p>Ingredients:</p><p>2 eggs</p><p>1 cup milk</p></article>');
        expect(parsePage(html, 'https://example.com/r')?.method).toBe('headings');
    });
    it('reads the caption on TikTok and Instagram', () => {
        const html = page(
            '',
            '<meta property="og:description" content="Ingredients:\n2 eggs\n1 cup milk">',
        );
        expect(parsePage(html, 'https://www.tiktok.com/@cook/video/1')?.method).toBe('caption');
    });
    it('returns null when nothing reads as a recipe', () => {
        expect(parsePage(page('<p>Hello</p>'), 'https://example.com')).toBeNull();
    });
});
