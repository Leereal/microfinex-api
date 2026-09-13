-- A reversal is not a cancellation.
--
-- Undoing a payment was recorded as CANCELLED, the same status as a payment
-- that never took effect at all. They are different events: a cancelled payment
-- has nothing behind it, a reversed one has loan balances restored and income
-- voided. Reporting cannot tell them apart while they share a status.
--
-- Adding an enum value must be its own migration: PostgreSQL will not let a new
-- label be used by statements in the transaction that created it.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REVERSED' AFTER 'CANCELLED';
