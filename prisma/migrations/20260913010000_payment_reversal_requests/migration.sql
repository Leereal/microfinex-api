-- Reversing a repayment goes through the same request and review as reversing
-- a disbursement.
--
-- Both undo money that has already moved, so both need someone to ask and
-- someone else to agree. Only what gets unwound at the end differs, which is
-- what `kind` records.
ALTER TABLE "loan_reversal_requests"
  ADD COLUMN IF NOT EXISTS "kind"      TEXT NOT NULL DEFAULT 'DISBURSEMENT',
  ADD COLUMN IF NOT EXISTS "paymentId" TEXT;

CREATE INDEX IF NOT EXISTS "loan_reversal_requests_paymentId_status_idx"
  ON "loan_reversal_requests"("paymentId", "status");

ALTER TABLE "loan_reversal_requests"
  DROP CONSTRAINT IF EXISTS "loan_reversal_requests_paymentId_fkey";

ALTER TABLE "loan_reversal_requests"
  ADD CONSTRAINT "loan_reversal_requests_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
