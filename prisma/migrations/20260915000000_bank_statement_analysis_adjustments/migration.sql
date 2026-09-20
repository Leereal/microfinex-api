-- A reviewer's adjustments to which transactions an analysis counts.
--
-- The headline columns hold the figures in effect: OBSE's own, or the
-- recalculated ones once a reviewer has adjusted. OBSE's originals always
-- remain in rawResponse.
ALTER TABLE "bank_statement_analyses" ADD COLUMN IF NOT EXISTS "reviewerOverrides" JSONB;
ALTER TABLE "bank_statement_analyses" ADD COLUMN IF NOT EXISTS "adjustedAt" TIMESTAMP(3);
ALTER TABLE "bank_statement_analyses" ADD COLUMN IF NOT EXISTS "adjustedById" TEXT;

ALTER TABLE "bank_statement_analyses"
  ADD CONSTRAINT "bank_statement_analyses_adjustedById_fkey"
  FOREIGN KEY ("adjustedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
