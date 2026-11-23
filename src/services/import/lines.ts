// Reads ingredients and steps out of plain lines of text: a blog post body or a
// social-media caption. Sections are found by their headings ("Ingredients for
// 4:", "Directions", "Optional:"); captions without headings fall back to what
// the lines look like.
import { type ParsedIngredient, stripStepNumber } from './common';

const INGREDIENTS = /^(?:the\s+)?ingredients?\b[^.!?]{0,60}:?$/i;
const INSTRUCTIONS =
    /^(?:directions?|instructions?|method|preparation|procedure|steps|how to (?:make|cook)(?: it)?)\b[^.!?]{0,40}:?$/i;
/** Where a recipe ends: notes, links, sign-offs, hashtags. */
const END =
    /^(?:notes?:?$|tips?:?$|nutrition\b|enjoy\b|view (?:the )?(?:complete|full)\b|(?:get|see|print|jump to) (?:the )?(?:full |complete |printable )?recipe\b|watch\b|recipe (?:card|notes)\b|follow\b|save (?:this|for)\b|#)/i;
/** "For the dressing:", "Optional:": a short label ending in a colon. */
const SUBHEAD = /^[^\d]{1,40}:$/;
/** A leading bullet, dash, check mark or emoji. */
const BULLET = /^(?:[-•*·▪◦●–—✓✔>]|\p{Extended_Pictographic}|️)+\s*/u;
/** Starts like an ingredient: an amount, or a word ingredients often start with. */
const LOOKS_LIKE_INGREDIENT =
    /^(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞]|(?:a|an|one|two|three|half|pinch|dash|handful|splash|salt|pepper|fresh|juice)\b)/i;
const NUMBERED_STEP = /^(?:step\s*)?\d{1,2}\s*[.):]\s+\S/i;

export interface LineRecipe {
    ingredients: ParsedIngredient[];
    instructions: string[];
}

/**
 * Ingredients and steps from lines of text. With `guess`, lines are also
 * recognised by their shape (amount first, numbered) when there are no headings.
 */
export function readRecipeLines(rawLines: string[], { guess = false } = {}): LineRecipe {
    const lines = rawLines.map((l) => l.replace(BULLET, '').trim()).filter(Boolean);
    const ingredients: ParsedIngredient[] = [];
    const instructions: string[] = [];
    let mode: 'after' | 'before' | 'ingredients' | 'instructions' = 'before';
    let optional = false;

    for (const line of lines) {
        if (INGREDIENTS.test(line) && line.length <= 70) {
            mode = 'ingredients';
            optional = false;
            continue;
        }
        if (INSTRUCTIONS.test(line) && line.length <= 50) {
            mode = 'instructions';
            continue;
        }
        if (END.test(line)) {
            if (mode === 'ingredients' || mode === 'instructions') mode = 'after';
            continue;
        }
        if (mode === 'ingredients') {
            if (SUBHEAD.test(line)) {
                optional = /\boptional\b/i.test(line);
                continue;
            }
            // A paragraph of prose ends the list.
            if (line.length > 200) {
                mode = 'after';
                continue;
            }
            ingredients.push({ optional, sentence: line });
        } else if (mode === 'instructions') {
            const step = stripStepNumber(line);
            // Skip leftovers such as a lone step number or a stray symbol.
            if (/\p{L}{2}/u.test(step)) instructions.push(step);
        } else if (guess) {
            if (NUMBERED_STEP.test(line)) {
                instructions.push(stripStepNumber(line));
            } else if (LOOKS_LIKE_INGREDIENT.test(line) && line.length <= 90) {
                ingredients.push({ optional: false, sentence: line });
            }
        }
    }
    return { ingredients, instructions };
}
