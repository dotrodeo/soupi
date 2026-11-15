import { ItemCategory } from '@prisma/client';

import prisma from '../../prisma';
import { SSEMessageType } from '../../utils/constants';
import { broadcast } from '../../utils/sse';

type ItemCategoryInput = Partial<
    Omit<ItemCategory, 'createdAt' | 'deletedAt' | 'pantryId' | 'updatedAt'>
> & {
    name: string;
};

/** Soft-deletes a category; its items become uncategorized. Resolves to false
 *  when the category isn't a live category in this household's pantry. */
export async function deleteCategory(
    householdId: number,
    pantryId: number,
    categoryId: number,
): Promise<boolean> {
    return broadcast<boolean>(
        householdId,
        SSEMessageType.CATEGORY_UPDATE,
        'deleteCategory',
        async () => {
            const { count } = await prisma.itemCategory.updateMany({
                data: { deletedAt: new Date() },
                where: { deletedAt: null, id: categoryId, pantry: { householdId }, pantryId },
            });
            if (count === 0) return false;
            await prisma.pantryItem.updateMany({
                data: { categoryId: null },
                where: { categoryId, pantryId },
            });
            return true;
        },
    );
}

export async function getCategories(
    householdId: number,
    pantryId: number,
): Promise<ItemCategory[]> {
    return prisma.itemCategory.findMany({
        orderBy: { sortOrder: 'asc' },
        where: { deletedAt: null, pantry: { householdId }, pantryId },
    });
}

export async function getCategory(
    householdId: number,
    pantryId: number,
    categoryId: number,
): Promise<ItemCategory> {
    return prisma.itemCategory.findFirstOrThrow({
        where: { deletedAt: null, id: categoryId, pantry: { householdId }, pantryId },
    });
}

export async function updateSortOrder(
    householdId: number,
    pantryId: number,
    categoryIdsInOrder: number[],
): Promise<void> {
    await broadcast<void>(
        householdId,
        SSEMessageType.CATEGORY_UPDATE,
        'updateSortOrder',
        async () => {
            // Validate household access to pantryId
            const pantry = await prisma.pantry.findUniqueOrThrow({
                where: { householdId, id: pantryId },
            });

            if (!pantry) {
                throw new Error('Pantry not found or access denied');
            }

            await prisma.$transaction(
                categoryIdsInOrder.map((categoryId, index) =>
                    prisma.itemCategory.updateMany({
                        data: { sortOrder: index },
                        where: { id: categoryId, pantryId },
                    }),
                ),
            );
        },
    );
}

export async function upsertCategory(
    householdId: number,
    pantryId: number,
    item: ItemCategoryInput,
): Promise<ItemCategory> {
    return await broadcast<ItemCategory>(
        householdId,
        SSEMessageType.CATEGORY_UPDATE,
        'upsertCategory',
        async () => {
            // Validate household access to pantryId
            const pantry = await prisma.pantry.findUniqueOrThrow({
                where: { householdId, id: pantryId },
            });

            if (!pantry) {
                throw new Error('Pantry not found or access denied');
            }

            const { id, ...data } = item;

            // By id when editing; by name when adding, so adding a name that
            // already exists updates it. Deleted categories never match: re-adding
            // a deleted name creates a fresh category.
            const existing = await prisma.itemCategory.findFirst({
                where: id
                    ? { deletedAt: null, id, pantryId }
                    : { deletedAt: null, name: item.name, pantryId },
            });

            if (id && !existing) {
                throw new Error('Category not found');
            }

            if (existing) {
                return prisma.itemCategory.update({
                    data,
                    where: { id: existing.id },
                });
            }

            return prisma.itemCategory.create({
                data: {
                    ...data,
                    pantryId,
                },
            });
        },
    );
}
