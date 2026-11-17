import { ItemCategory } from '@prisma/client';

import prisma from '../../prisma';
import { SSEMessageType } from '../../utils/constants';
import { broadcast } from '../../utils/sse';

/**
 * Puts several items on the shopping list in one go (e.g. everything the meal
 * plan is missing). `itemIds` are existing pantry items; `names` are ingredients
 * with no pantry item yet. A name matches an existing item case-insensitively,
 * otherwise a new out-of-stock, uncategorized item is created. One live update
 * is sent for the whole batch. Resolves to how many items are now on the list.
 */
export async function addToList(
    householdId: number,
    pantryId: number,
    { itemIds = [], names = [] }: { itemIds?: number[]; names?: string[] },
): Promise<{ added: number }> {
    return broadcast<{ added: number }>(
        householdId,
        SSEMessageType.PANTRY_UPDATE,
        'addToShoppingList',
        async () => {
            // Throws if the pantry isn't this household's.
            await prisma.pantry.findUniqueOrThrow({ where: { householdId, id: pantryId } });

            const unique = [
                ...new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()])).values(),
            ];
            const existing = unique.length
                ? await prisma.pantryItem.findMany({
                      select: { id: true, name: true },
                      where: {
                          deletedAt: null,
                          OR: unique.map((name) => ({
                              name: { equals: name, mode: 'insensitive' as const },
                          })),
                          pantryId,
                      },
                  })
                : [];
            const known = new Set(existing.map((i) => i.name.toLowerCase()));
            const ids = [...new Set([...existing.map((i) => i.id), ...itemIds])];
            const toCreate = unique.filter((n) => !known.has(n.toLowerCase()));

            const [flagged, created] = await prisma.$transaction([
                prisma.pantryItem.updateMany({
                    data: { isInShoppingList: true },
                    where: { deletedAt: null, id: { in: ids }, pantryId },
                }),
                prisma.pantryItem.createMany({
                    data: toCreate.map((name) => ({
                        isInShoppingList: true,
                        isInStock: false,
                        name,
                        pantryId,
                    })),
                }),
            ]);
            return { added: flagged.count + created.count };
        },
    );
}

export async function getListByCategory(
    householdId: number,
    pantryId: number,
): Promise<ItemCategory[]> {
    return prisma.itemCategory.findMany({
        include: {
            pantryItems: {
                where: { deletedAt: null },
            },
        },
        orderBy: { sortOrder: 'asc' },
        where: {
            deletedAt: null,
            pantry: { householdId },
            pantryId,
            pantryItems: {
                some: {
                    deletedAt: null,
                },
            },
        },
    });
}
