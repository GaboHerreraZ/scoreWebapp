/*
  Warnings:

  - You are about to drop the column `full_name` on the `profiles` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "profiles" DROP COLUMN "full_name",
ADD COLUMN     "last_name" VARCHAR(150),
ADD COLUMN     "name" VARCHAR(150),
ADD COLUMN     "position" VARCHAR(150),
ADD COLUMN     "role_id" INTEGER;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
