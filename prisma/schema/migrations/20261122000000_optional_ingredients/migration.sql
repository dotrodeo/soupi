-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "optional" BOOLEAN NOT NULL DEFAULT false;

-- Existing lines that say "optional" ("parsley, optional") become optional, the same
-- rule the API applies to new plain-text lines.
UPDATE "Ingredient" SET "optional" = true WHERE "sentence" ~* '\moptional\M';
