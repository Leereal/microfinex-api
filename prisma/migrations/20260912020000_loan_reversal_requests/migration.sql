-- Requests to undo a disbursement that has already happened.
--
-- A disbursement moves money, applies charges, consumes part of the client's
-- credit limit and starts a repayment schedule. Undoing it is a set of
-- compensating entries rather than a status change, so it is requested,
-- reviewed, and recorded.

CREATE TABLE IF NOT EXISTS "loan_reversal_requests" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "loanId"         TEXT NOT NULL,
  "requestedById"  TEXT NOT NULL,
  "reason"         TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedById"   TEXT,
  "reviewedAt"     TIMESTAMP(3),
  "reviewNotes"    TEXT,
  "reversalRecord" JSONB,
  "reversedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loan_reversal_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "loan_reversal_requests_organizationId_status_idx"
  ON "loan_reversal_requests" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "loan_reversal_requests_loanId_status_idx"
  ON "loan_reversal_requests" ("loanId", "status");
CREATE INDEX IF NOT EXISTS "loan_reversal_requests_requestedById_idx"
  ON "loan_reversal_requests" ("requestedById");

ALTER TABLE "loan_reversal_requests"
  ADD CONSTRAINT "loan_reversal_requests_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loan_reversal_requests"
  ADD CONSTRAINT "loan_reversal_requests_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "loans"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loan_reversal_requests"
  ADD CONSTRAINT "loan_reversal_requests_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_reversal_requests"
  ADD CONSTRAINT "loan_reversal_requests_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
