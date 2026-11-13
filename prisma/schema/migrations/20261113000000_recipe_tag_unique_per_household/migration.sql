-- DropIndex
DROP INDEX "RecipeTag_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "RecipeTag_householdId_name_key" ON "RecipeTag"("householdId", "name");

