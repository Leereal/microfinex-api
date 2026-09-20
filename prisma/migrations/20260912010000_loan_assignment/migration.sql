-- Optionally assign one person to assess or disburse a loan.
--
-- Without this, a notification about work to be done had to go to everyone who
-- held the permission. That is the right default, but a branch that has decided
-- who is handling a particular loan wants it to reach that person and nobody
-- else.

ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "assignedAssessorId" TEXT;
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "assignedDisburserId" TEXT;

CREATE INDEX IF NOT EXISTS "loans_assignedAssessorId_idx" ON "loans" ("assignedAssessorId");
CREATE INDEX IF NOT EXISTS "loans_assignedDisburserId_idx" ON "loans" ("assignedDisburserId");

ALTER TABLE "loans"
  ADD CONSTRAINT "loans_assignedAssessorId_fkey"
  FOREIGN KEY ("assignedAssessorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "loans"
  ADD CONSTRAINT "loans_assignedDisburserId_fkey"
  FOREIGN KEY ("assignedDisburserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
