import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pages = new Map<string, string>();
const generateObject = vi.fn();

vi.mock('puppeteer', () => ({
    default: {
        launch: vi.fn(async () => ({
            close: vi.fn(),
            newPage: vi.fn(async () => {
                let url = '';
                return {
                    content: vi.fn(async () => pages.get(url) ?? '<html></html>'),
                    goto: vi.fn(async (u: string) => {
                        url = u;
                    }),
                };
            }),
        })),
    },
}));
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }));
vi.mock('@ai-sdk/openai', () => ({ openai: vi.fn(() => 'model') }));
vi.mock('../../../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn() } }));

const { scrapeRecipe } = await import('../../../src/services/scraper');

const recipePage = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@type': 'Recipe',
    name: 'Toast',
    prepTime: 'PT5M',
    recipeIngredient: ['2 slices bread', 'butter'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Toast the bread.' }],
})}</script></head><body></body></html>`;
const chattyPage =
    '<html><head><meta property="og:description" content="Made soup again, so cozy!"></head><body></body></html>';

describe('scrapeRecipe()', () => {
    const savedKey = process.env.OPENAI_API_KEY;
    beforeEach(() => {
        pages.clear();
        generateObject.mockReset();
    });
    afterEach(() => {
        if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = savedKey;
    });

    it('reads structured data without the AI', async () => {
        process.env.OPENAI_API_KEY = 'test';
        pages.set('https://example.com/toast', recipePage);

        const recipe = await scrapeRecipe('https://example.com/toast');

        expect(recipe).toEqual({
            cookTime: null,
            ingredients: ['2 slices bread', 'butter'],
            instructions: ['Toast the bread.'],
            name: 'Toast',
            notes: null,
            optionalIngredients: [],
            prepTime: '5 mins',
            servings: null,
            source: 'https://example.com/toast',
        });
        expect(generateObject).not.toHaveBeenCalled();
    });

    it('returns null without an AI key when the rules find nothing', async () => {
        delete process.env.OPENAI_API_KEY;
        pages.set('https://www.instagram.com/p/1', chattyPage);

        expect(await scrapeRecipe('https://www.instagram.com/p/1')).toBeNull();
        expect(generateObject).not.toHaveBeenCalled();
    });

    it('asks the AI about a caption the rules can not read, when a key is set', async () => {
        process.env.OPENAI_API_KEY = 'test';
        pages.set('https://www.instagram.com/p/1', chattyPage);
        generateObject.mockResolvedValue({
            object: { ingredients: ['carrots', 'stock'], instructions: ['Simmer.'], name: 'Soup' },
        });

        const recipe = await scrapeRecipe('https://www.instagram.com/p/1');

        expect(generateObject).toHaveBeenCalledTimes(1);
        expect(generateObject.mock.calls[0][0].prompt).toContain('Made soup again, so cozy!');
        expect(recipe).toMatchObject({
            ingredients: ['carrots', 'stock'],
            instructions: ['Simmer.'],
            name: 'Soup',
            source: 'https://www.instagram.com/p/1',
        });
    });

    it('follows a recipe link the AI finds, once', async () => {
        process.env.OPENAI_API_KEY = 'test';
        pages.set('https://www.tiktok.com/@cook/video/1', chattyPage);
        pages.set('https://example.com/toast', recipePage);
        generateObject.mockResolvedValue({
            object: {
                externalLink: 'https://example.com/toast',
                ingredients: [],
                instructions: [],
            },
        });

        const recipe = await scrapeRecipe('https://www.tiktok.com/@cook/video/1');

        expect(recipe?.name).toBe('Toast');
        expect(recipe?.source).toBe('https://example.com/toast');
        expect(generateObject).toHaveBeenCalledTimes(1);
    });
});
