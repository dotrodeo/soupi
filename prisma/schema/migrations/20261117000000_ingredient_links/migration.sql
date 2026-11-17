-- CreateTable
CREATE TABLE "IngredientLink" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "householdId" INTEGER NOT NULL,
    "pantryItemId" INTEGER,

    CONSTRAINT "IngredientLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngredientLink_pantryItemId_idx" ON "IngredientLink"("pantryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientLink_householdId_name_key" ON "IngredientLink"("householdId", "name");

-- AddForeignKey
ALTER TABLE "IngredientLink" ADD CONSTRAINT "IngredientLink_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientLink" ADD CONSTRAINT "IngredientLink_pantryItemId_fkey" FOREIGN KEY ("pantryItemId") REFERENCES "PantryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
