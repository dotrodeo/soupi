import { Pantry, PantryItem } from '@prisma/client';

import prisma from '../../prisma';
import { SSEMessageType } from '../../utils/constants';
import { broadcast } from '../../utils/sse';

type PantryItemInput = Partial<Omit<PantryItem, 'createdAt' | 'deletedAt' | 'updatedAt'>> & {
    name: string;
    pantryId: number;
};

export async function getAllPantryItems(
    householdId: number,
    pantryId: number,
): Promise<PantryItem[]> {
    return prisma.pantryItem.findMany({
        include: { category: true },
        where: { deletedAt: null, pantry: { householdId }, pantryId },
    });
}

export async function getPantries(householdId: number): Promise<Pantry> {
    // TODO: Get user's default pantry
    return prisma.pantry.findFirstOrThrow({
        include: {
            itemCategories: { orderBy: { sortOrder: 'asc' }, where: { deletedAt: null } },
            pantryItems: {
                include: { category: true },
                orderBy: { id: 'asc' },
                where: { deletedAt: null },
            },
        },
        where: { householdId },
    });
}

export async function getPantryItem(
    householdId: number,
    pantryId: number,
    itemId: number,
): Promise<PantryItem> {
    return prisma.pantryItem.findUniqueOrThrow({
        include: { category: true },
        where: { id: itemId, pantry: { householdId }, pantryId },
    });
}

export async function upsertPantryItem(
    householdId: number,
    item: PantryItemInput,
): Promise<PantryItem> {
    return await broadcast<PantryItem>(
        householdId,
        SSEMessageType.PANTRY_UPDATE,
        'upsertPantryItem',
        async () => {
            // Validate household access to pantryId
            const pantry = await prisma.pantry.findUniqueOrThrow({
                where: { householdId, id: item.pantryId },
            });

            if (!pantry) {
                throw new Error('Pantry not found or access denied');
            }

            const { id, ...data } = item;

            // An out-of-stock item is no longer in the pantry, so any expiration
            // date is meaningless — clear it whenever stock is set to false.
            if (data.isInStock === false) {
                data.expiresAt = null;
            }

            // "Low" means in stock but running low. Marking an item out, or back in
            // stock (restocked) without saying it's low, clears it; marking it low
            // implies it's in stock.
            if (data.isInStock === false) {
                data.isLow = false;
            } else if (data.isLow === true) {
                data.isInStock = true;
            } else if (data.isInStock === true && data.isLow === undefined) {
                data.isLow = false;
            }

            // Match the row to update: by id when the client knows it, otherwise
            // by name within this pantry. Must exclude soft-deleted rows and scope
            // to the pantry — otherwise a same-named ghost (or any other item) is
            // matched and the edit lands on the wrong row (lost update).
            const existing = await prisma.pantryItem.findFirst({
                where: id ? { id } : { deletedAt: null, name: item.name, pantryId: item.pantryId },
            });

            if (existing) {
                return prisma.pantryItem.update({
                    data,
                    include: { category: true },
                    where: { id: existing.id },
                });
            }

            const newItem = prisma.pantryItem.create({
                data: {
                    ...data,
                },
                include: { category: true },
            });

            return newItem;
        },
    );
}
