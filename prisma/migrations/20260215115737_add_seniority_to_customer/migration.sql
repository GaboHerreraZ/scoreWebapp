/*
  Warnings:

  - You are about to drop the column `role` on the `user_companies` table. All the data in the column will be lost.
  - Added the required column `role_id` to the `user_companies` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "seniority" INTEGER;

-- AlterTable
ALTER TABLE "user_companies" DROP COLUMN "role",
ADD COLUMN     "role_id" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
