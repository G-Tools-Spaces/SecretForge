-- AlterTable
ALTER TABLE "Secret" ADD COLUMN     "group" TEXT NOT NULL DEFAULT '';

-- DropIndex
DROP INDEX "Secret_environmentId_key_key";

-- CreateIndex
CREATE UNIQUE INDEX "Secret_environmentId_group_key_key" ON "Secret"("environmentId", "group", "key");
