-- Who reversed a payment, when, and why.
--
-- This was only ever appended to the payment's free-text notes, so a reversal
-- could be read but never listed, counted or reported on, and the person who
-- did it was not recorded anywhere at all.
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "reversedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reversedById"   TEXT,
  ADD COLUMN IF NOT EXISTS "reversalReason" TEXT;

CREATE INDEX IF NOT EXISTS "payments_reversedById_idx"
  ON "payments"("reversedById");

ALTER TABLE "payments"
  DROP CONSTRAINT IF EXISTS "payments_reversedById_fkey";

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_reversedById_fkey"
  FOREIGN KEY ("reversedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Bring across the reversals that were recorded as cancellations. They are
-- recognisable by the marker the service wrote into the notes.
UPDATE "payments"
SET "status" = 'REVERSED',
    "reversedAt" = COALESCE("reversedAt", "updatedAt"),
    "reversalReason" = COALESCE(
      "reversalReason",
      NULLIF(split_part(split_part("notes", 'REVERSED: ', 2), E'\n', 1), '')
    )
WHERE "status" = 'CANCELLED'
  AND "notes" LIKE '%REVERSED:%';
