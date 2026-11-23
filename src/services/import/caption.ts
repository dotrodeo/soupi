// Recipes from a TikTok or Instagram caption (the page's og:description).
import { cleanText, type ParsedRecipe } from './common';
import { readRecipeLines } from './lines';

/**
 * The caption itself, without the wrapper the sites add, e.g.
 * `1,234 likes, 56 comments - cook on May 1, 2026: "caption…". ` (Instagram).
 */
export function captionText(description: string): string {
    const text = description.replace(/\r/g, '').trim();
    const quoted = /^[^"\n]{0,200}?:\s*"([\s\S]*)"\.?\s*$/.exec(text);
    return (quoted ? quoted[1] : text).trim();
}

/** A recipe from a caption, if it has at least two ingredients. */
export function fromCaption(description: null | string | undefined): null | ParsedRecipe {
    if (!description) return null;
    const caption = captionText(description);
    const lines = captionLines(caption);
    const { ingredients, instructions } = readRecipeLines(lines, { guess: true });
    if (ingredients.length < 2) return null;
    // The first line names the dish when it's short and isn't part of the recipe.
    const first = cleanText(lines[0]?.replace(/#\S+/g, ''));
    const usedFirst = ingredients.some((i) => i.sentence === first) || instructions.includes(first);
    const name = first && first.length <= 80 && !usedFirst ? first.replace(/[:!.\s]+$/, '') : null;
    return {
        cookTime: null,
        ingredients,
        instructions,
        name,
        notes: null,
        prepTime: null,
        servings: null,
    };
}

/** Caption lines; a single run-on line is split at bullets and step numbers. */
function captionLines(caption: string): string[] {
    const lines = caption.split('\n');
    if (lines.length > 2) return lines;
    return caption.split(
        /\s+(?=[-•▪◦●✓✔]\s)|\s+(?=(?:step\s*)?\d{1,2}[.)]\s)|\s+(?=(?:ingredients?|instructions?|directions?|method|steps)\s*:)|(?<=\b(?:ingredients?|instructions?|directions?|method|steps)\s*:)\s+/i,
    );
}
