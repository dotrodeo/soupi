// Household fixes for matching recipe ingredients to the pantry (sous-web#39).
import { IngredientLink } from '@prisma/client';

import prisma from '../../prisma';
import { SSEMessageType } from '../../utils/constants';
import { broadcast } from '../../utils/sse';
import { NotFoundError } from '../middleware/errors';

export async function deleteLink(householdId: number, id: number): Promise<void> {
    await broadcast<void>(
        householdId,
        SSEMessageType.PANTRY_UPDATE,
        'deleteIngredientLink',
        async () => {
            const { count } = await prisma.ingredientLink.deleteMany({
                where: { householdId, id },
            });
            if (!count) throw new NotFoundError('Ingredient link not found');
        },
    );
}

export async function listLinks(householdId: number): Promise<IngredientLink[]> {
    return prisma.ingredientLink.findMany({
        include: { pantryItem: { select: { deletedAt: true, id: true, name: true } } },
        orderBy: { name: 'asc' },
        where: { householdId },
    });
}

/** The key a link is saved under: "  Green  Onions " → "green onions". Clients
 *  normalize an ingredient's name the same way to look its link up. */
export function normalizeIngredientName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Saves how an ingredient matches: a pantry item of this household, or
 *  `pantryItemId: null` for "always have, don't track". */
export async function upsertLink(
    householdId: number,
    { name, pantryItemId }: { name: string; pantryItemId: null | number },
): Promise<IngredientLink> {
    return broadcast<IngredientLink>(
        householdId,
        SSEMessageType.PANTRY_UPDATE,
        'upsertIngredientLink',
        async () => {
            if (pantryItemId != null) {
                const item = await prisma.pantryItem.findFirst({
                    select: { id: true },
                    where: { deletedAt: null, id: pantryItemId, pantry: { householdId } },
                });
                if (!item) throw new NotFoundError('Pantry item not found');
            }
            const key = normalizeIngredientName(name);
            return prisma.ingredientLink.upsert({
                create: { householdId, name: key, pantryItemId },
                include: { pantryItem: { select: { deletedAt: true, id: true, name: true } } },
                update: { pantryItemId },
                where: { householdId_name: { householdId, name: key } },
            });
        },
    );
}
