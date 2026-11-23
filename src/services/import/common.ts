import he from 'he';

/** An ingredient line from an import; `optional` from an "Optional:" heading. */
export interface ParsedIngredient {
    optional: boolean;
    sentence: string;
}

/** A recipe read from a page or caption, before it's saved. */
export interface ParsedRecipe {
    cookTime: null | string;
    ingredients: ParsedIngredient[];
    instructions: string[];
    name: null | string;
    notes: null | string;
    prepTime: null | string;
    servings: null | string;
}

/** Text without tags, entities decoded, whitespace collapsed. */
export function cleanText(value: unknown): string {
    if (value == null) return '';
    return (
        he
            .decode(String(value).replace(/<[^>]*>/g, ' '))
            .replace(/\s+/g, ' ')
            // A tag next to punctuation leaves a space before it ("<b>onions</b>.").
            .replace(/\s+([.,;:!?)])/g, '$1')
            .trim()
    );
}

/**
 * A schema.org duration ("PT1H30M", "P0DT0H45M") as "1 hour 30 mins"; anything
 * else is returned as given. Zero or missing is null.
 */
export function formatDuration(value: unknown): null | string {
    const text = cleanText(value);
    if (!text) return null;
    const match =
        /^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:\d+(?:\.\d+)?S)?)?$/i.exec(
            text,
        );
    if (!match) return text;
    const minutes =
        Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    if (minutes <= 0) return null;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return [
        hours > 0 && `${hours} hour${hours > 1 ? 's' : ''}`,
        mins > 0 && `${mins} min${mins > 1 ? 's' : ''}`,
    ]
        .filter(Boolean)
        .join(' ');
}

/** Servings from schema.org recipeYield: a string, a number, or a list of either. */
export function formatYield(value: unknown): null | string {
    const values = (Array.isArray(value) ? value : [value]).map(cleanText).filter(Boolean);
    if (values.length === 0) return null;
    // ["4", "4 servings"]: the wordier one says more.
    return values.find((v) => /\D/.test(v)) ?? values[0];
}

/** Enough to be worth keeping: a name and at least one ingredient. */
export function isUsable(recipe: null | ParsedRecipe): recipe is ParsedRecipe {
    return !!recipe && recipe.ingredients.length > 0;
}

/** A step without its own numbering ("1.", "Step 2:", "3)"). */
export function stripStepNumber(step: string): string {
    return step.replace(/^(?:step\s*)?\d{1,2}\s*[.):-]\s*/i, '').trim();
}
