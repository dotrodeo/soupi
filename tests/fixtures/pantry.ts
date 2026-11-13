import type { ItemCategory, Pantry, PantryItem } from '@prisma/client';

export const mockCategory: ItemCategory = {
    createdAt: new Date('2024-01-01'),
    deletedAt: null,
    icon: '🥦',
    id: 1,
    isNonFood: false,
    name: 'Produce',
    pantryId: 1,
    sortOrder: 0,
    updatedAt: new Date('2024-01-01'),
};

export const mockPantryItem: PantryItem = {
    categoryId: 1,
    createdAt: new Date('2024-01-01'),
    deletedAt: null,
    expiresAt: null,
    id: 1,
    isFavorite: false,
    isInShoppingList: false,
    isInStock: true,
    name: 'Flour',
    pantryId: 1,
    purchasedAt: new Date('2024-01-01'),
    quantity: null,
    updatedAt: new Date('2024-01-01'),
};

export const mockPantry: Pantry & { itemCategories: ItemCategory[]; pantryItems: PantryItem[] } = {
    createdAt: new Date('2024-01-01'),
    deletedAt: null,
    householdId: 1,
    id: 1,
    isDefault: true,
    itemCategories: [mockCategory],
    name: 'My Pantry',
    pantryItems: [mockPantryItem],
    updatedAt: new Date('2024-01-01'),
};
