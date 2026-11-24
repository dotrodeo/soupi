-- CreateTable
CREATE TABLE "Meal" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "lastMade" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "householdId" INTEGER NOT NULL,

    CONSTRAINT "Meal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealItem" (
    "id" SERIAL NOT NULL,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mealId" INTEGER NOT NULL,
    "pantryItemId" INTEGER NOT NULL,

    CONSTRAINT "MealItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PlanDayMeals" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_PlanDayMeals_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Meal_householdId_idx" ON "Meal"("householdId");

-- CreateIndex
CREATE INDEX "MealItem_pantryItemId_idx" ON "MealItem"("pantryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MealItem_mealId_pantryItemId_key" ON "MealItem"("mealId", "pantryItemId");

-- CreateIndex
CREATE INDEX "_PlanDayMeals_B_index" ON "_PlanDayMeals"("B");

-- AddForeignKey
ALTER TABLE "Meal" ADD CONSTRAINT "Meal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealItem" ADD CONSTRAINT "MealItem_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealItem" ADD CONSTRAINT "MealItem_pantryItemId_fkey" FOREIGN KEY ("pantryItemId") REFERENCES "PantryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PlanDayMeals" ADD CONSTRAINT "_PlanDayMeals_A_fkey" FOREIGN KEY ("A") REFERENCES "Meal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PlanDayMeals" ADD CONSTRAINT "_PlanDayMeals_B_fkey" FOREIGN KEY ("B") REFERENCES "PlanDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

