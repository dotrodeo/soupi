export const DEFAULT_CATEGORIES = [
    { icon: '🍎', name: 'Produce', sortOrder: 0 },
    { icon: '🍞', name: 'Bakery', sortOrder: 1 },
    { icon: '🧀', name: 'Deli', sortOrder: 2 },
    { icon: '🍖', name: 'Meat & Seafood', sortOrder: 3 },
    { icon: '🥫', name: 'Grocery', sortOrder: 4 },
    { icon: '🧂', name: 'Condiments & Spices', sortOrder: 5 },
    { icon: '🍰', name: 'Baking', sortOrder: 6 },
    { icon: '🍝', name: 'Pasta, Rice & Grains', sortOrder: 7 },
    { icon: '🥫', name: 'Canned Goods', sortOrder: 8 },
    { icon: '🥨', name: 'Snacks', sortOrder: 9 },
    { icon: '🧃', name: 'Beverages', sortOrder: 10 },
    { icon: '🥛', name: 'Dairy', sortOrder: 11 },
    { icon: '🍦', name: 'Frozen', sortOrder: 12 },
    { icon: '🍼', isNonFood: true, name: 'Baby & Kids', sortOrder: 13 },
    { icon: '🐾', isNonFood: true, name: 'Pet Supplies', sortOrder: 14 },
    { icon: '🧼', isNonFood: true, name: 'Cleaning Supplies', sortOrder: 15 },
    { icon: '🧴', isNonFood: true, name: 'Household', sortOrder: 16 },
    { icon: '🪥', isNonFood: true, name: 'Personal Care', sortOrder: 17 },
    { icon: '💊', isNonFood: true, name: 'Health', sortOrder: 18 },
    { icon: '🛠️', isNonFood: true, name: 'Hardware', sortOrder: 19 },
    { icon: '🛒', name: 'Other', sortOrder: 20 },
];

export const DEFAULT_TAGS = [
    { name: 'breakfast' },
    { name: 'brunch' },
    { name: 'lunch' },
    { name: 'dinner' },
    { name: 'dessert' },
    { name: 'side dish' },
    { name: 'easy' },
    { name: 'quick' },
    { name: 'vegetarian' },
];

export enum SSEMessageType {
    CATEGORY_UPDATE = 'category_update',
    PANTRY_UPDATE = 'pantry_update',
    RECIPE_DELETE = 'recipe_delete',
    RECIPE_UPDATE = 'recipe_update',
    USER_UPDATE = 'user_update',
}
