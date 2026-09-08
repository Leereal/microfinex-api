-- Widen ChargeRate.percentage so whole-number percentages fit.
--
-- Percentages are stored as whole numbers (10 = 10%), matching
-- charges."defaultPercentage" which is already NUMERIC(10,4). This column was
-- left at NUMERIC(5,4), capping it at 9.9999 — so saving any currency-specific
-- rate of 10% or more failed with a numeric field overflow.
ALTER TABLE "charge_rates"
  ALTER COLUMN "percentage" TYPE NUMERIC(10, 4);

-- Indexes on the transactional core.
--
-- PostgreSQL does not create indexes for foreign keys, and Prisma only emits
-- them for @@index/@unique. Every tenant-scoped listing was therefore a
-- sequential scan. CONCURRENTLY is deliberately not used so this runs inside
-- the migration transaction; on a large existing dataset, run these manually
-- with CONCURRENTLY instead to avoid write locks.

-- Loans: tenant listings, branch filters, officer assignment, engine sweeps
CREATE INDEX IF NOT EXISTS "loans_organizationId_status_idx"
  ON "loans" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "loans_organizationId_branchId_idx"
  ON "loans" ("organizationId", "branchId");
CREATE INDEX IF NOT EXISTS "loans_clientId_idx"
  ON "loans" ("clientId");
CREATE INDEX IF NOT EXISTS "loans_loanOfficerId_idx"
  ON "loans" ("loanOfficerId");
CREATE INDEX IF NOT EXISTS "loans_status_maturityDate_idx"
  ON "loans" ("status", "maturityDate");

-- Clients
CREATE INDEX IF NOT EXISTS "clients_organizationId_isActive_idx"
  ON "clients" ("organizationId", "isActive");
CREATE INDEX IF NOT EXISTS "clients_organizationId_branchId_idx"
  ON "clients" ("organizationId", "branchId");
CREATE INDEX IF NOT EXISTS "clients_email_idx"
  ON "clients" ("email");

-- Payments
CREATE INDEX IF NOT EXISTS "payments_loanId_paymentDate_idx"
  ON "payments" ("loanId", "paymentDate");
CREATE INDEX IF NOT EXISTS "payments_status_idx"
  ON "payments" ("status");
CREATE INDEX IF NOT EXISTS "payments_paymentDate_idx"
  ON "payments" ("paymentDate");

-- Repayment schedule: arrears detection scans these constantly
CREATE INDEX IF NOT EXISTS "repayment_schedules_loanId_dueDate_idx"
  ON "repayment_schedule" ("loanId", "dueDate");
CREATE INDEX IF NOT EXISTS "repayment_schedules_status_dueDate_idx"
  ON "repayment_schedule" ("status", "dueDate");

-- Users and branches
CREATE INDEX IF NOT EXISTS "users_organizationId_isActive_idx"
  ON "users" ("organizationId", "isActive");
CREATE INDEX IF NOT EXISTS "users_branchId_idx"
  ON "users" ("branchId");
CREATE INDEX IF NOT EXISTS "branches_organizationId_isActive_idx"
  ON "branches" ("organizationId", "isActive");

-- Loan products and client limits
CREATE INDEX IF NOT EXISTS "loan_products_organizationId_isActive_idx"
  ON "loan_products" ("organizationId", "isActive");
CREATE INDEX IF NOT EXISTS "client_limits_clientId_isActive_idx"
  ON "client_limits" ("clientId", "isActive");

-- Financial transactions
CREATE INDEX IF NOT EXISTS "financial_transactions_organizationId_transactionDate_idx"
  ON "financial_transactions" ("organizationId", "transactionDate");
CREATE INDEX IF NOT EXISTS "financial_transactions_relatedLoanId_idx"
  ON "financial_transactions" ("relatedLoanId");
CREATE INDEX IF NOT EXISTS "financial_transactions_relatedPaymentId_idx"
  ON "financial_transactions" ("relatedPaymentId");

-- Audit log: the audit UI filters by tenant and actor over time
CREATE INDEX IF NOT EXISTS "audit_logs_organizationId_timestamp_idx"
  ON "audit_logs" ("organizationId", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_logs_userId_timestamp_idx"
  ON "audit_logs" ("userId", "timestamp");
CREATE INDEX IF NOT EXISTS "audit_logs_resource_resourceId_idx"
  ON "audit_logs" ("resource", "resourceId");

-- Loan charges and client documents
CREATE INDEX IF NOT EXISTS "loan_charges_loanId_idx"
  ON "loan_charges" ("loanId");
CREATE INDEX IF NOT EXISTS "client_documents_clientId_idx"
  ON "client_documents" ("clientId");
