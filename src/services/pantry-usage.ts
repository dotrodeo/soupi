// "I made this": the pantry items a recipe or meal used up or left running low.
import { Prisma } from '@prisma/client';

export interface PantryUsage {
    finishedPantryItems?: number[];
    /** Pantry items that are now running low (kept in stock, marked low). */
    lowPantryItems?: number[];
}

/**
 * Marks used-up items out of stock (staples go back on the shopping list) and
 * running-low ones low. Only this household's items change; other ids are ignored.
 */
export async function applyPantryUsage(
    tx: Prisma.TransactionClient,
    householdId: number,
    usage: PantryUsage,
): Promise<void> {
    const finished = usage.finishedPantryItems ?? [];
    const items = await tx.pantryItem.findMany({
        select: { id: true, isFavorite: true },
        where: { id: { in: finished }, pantry: { householdId } },
    });

    for (const item of items) {
        await tx.pantryItem.update({
            data: {
                isInShoppingList: item.isFavorite ? true : false,
                isInStock: false,
                isLow: false,
            },
            where: { id: item.id },
        });
    }

    // Running low: still in stock, marked low. Used up wins if an item is in both.
    const low = (usage.lowPantryItems ?? []).filter((id) => !finished.includes(id));
    if (low.length > 0) {
        await tx.pantryItem.updateMany({
            data: { isInStock: true, isLow: true },
            where: { id: { in: low }, pantry: { householdId } },
        });
    }
}
