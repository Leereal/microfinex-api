-- Reclassify the top-ups that were written before LOAN_TOPUP existed.
UPDATE "payments"
SET "type" = 'LOAN_TOPUP'
WHERE "paymentNumber" LIKE 'TOPUP-%'
  AND "type" = 'LOAN_DISBURSEMENT';

-- A top-up's principalAmount records what was added to the loan; the cash that
-- actually left is "amount", and the difference is the charges deducted. Older
-- rows stored the cash in both columns, which loses the charge. Recover the
-- added principal from the charge raised against that top-up, whose baseAmount
-- is precisely the amount advanced.
UPDATE "payments" p
SET "principalAmount" = c."baseAmount"
FROM "loan_charges" c
WHERE p."type" = 'LOAN_TOPUP'
  AND c."loanId" = p."loanId"
  AND c."baseAmount" > p."amount"
  AND abs(extract(epoch FROM (c."appliedAt" - p."paymentDate"))) < 120;
