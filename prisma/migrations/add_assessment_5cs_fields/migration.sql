/*
  Warnings:

  - Added the required column `clientCharacter` to the `loan_assessments` table without a default value. This is not possible if the table has existing records.
  - Added the required column `clientCapacity` to the `loan_assessments` table without a default value. This is not possible if the table has existing records.
  - Added the required column `collateralQuality` to the `loan_assessments` table without a default value. This is not possible if the table has existing records.
  - Added the required column `conditions` to the `loan_assessments` table without a default value. This is not possible if the table has existing records.
  - Added the required column `capitalAdequacy` to the `loan_assessments` table without a default value. This is not possible if the table has existing records.
  - Added the required column `recommendation` to the `loan_assessments` table without a default value. This is not possible if the table has existing records.

*/
-- AlterTable
ALTER TABLE "loan_assessments" ADD COLUMN "clientCharacter" VARCHAR(50),
ADD COLUMN "clientCapacity" VARCHAR(50),
ADD COLUMN "collateralQuality" VARCHAR(50),
ADD COLUMN "conditions" VARCHAR(50),
ADD COLUMN "capitalAdequacy" VARCHAR(50),
ADD COLUMN "recommendedAmount" DECIMAL(15,2),
ADD COLUMN "recommendation" VARCHAR(50);
