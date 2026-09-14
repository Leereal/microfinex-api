-- Bank statement affordability analyses, run through OBSE.
--
-- OBSE's full response is kept verbatim in rawResponse; the headline columns
-- beside it are copied from its summary for listing, never a replacement.
CREATE TABLE IF NOT EXISTS "bank_statement_analyses" (
  "id"                   TEXT PRIMARY KEY,
  "organizationId"       TEXT NOT NULL,
  "clientId"             TEXT NOT NULL,
  "status"               TEXT NOT NULL DEFAULT 'PENDING',
  "provider"             TEXT NOT NULL DEFAULT 'OBSE',
  "statementDocumentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "payslipDocumentIds"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "customerType"         TEXT NOT NULL,
  "referenceNumber"      TEXT,
  "endpoint"             TEXT NOT NULL,
  "httpStatus"           INTEGER,
  "durationMs"           INTEGER,
  "monthlyIncome"        DECIMAL(15,2),
  "monthlyExpenses"      DECIMAL(15,2),
  "disposableIncome"     DECIMAL(15,2),
  "suggestedRepayment"   DECIMAL(15,2),
  "primaryMonthlySalary" DECIMAL(15,2),
  "incomeVolatility"     TEXT,
  "fraudFindingsCount"   INTEGER,
  "bankName"             TEXT,
  "statementFrom"        TEXT,
  "statementTo"          TEXT,
  "statementMonths"      INTEGER,
  "policyVersion"        TEXT,
  "rawResponse"          JSONB,
  "errorMessage"         TEXT,
  "errorCode"            TEXT,
  "requestedById"        TEXT NOT NULL,
  "startedAt"            TIMESTAMP(3),
  "completedAt"          TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bank_statement_analyses_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bank_statement_analyses_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bank_statement_analyses_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "bank_statement_analyses_organizationId_clientId_idx"
  ON "bank_statement_analyses"("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "bank_statement_analyses_clientId_createdAt_idx"
  ON "bank_statement_analyses"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "bank_statement_analyses_status_startedAt_idx"
  ON "bank_statement_analyses"("status", "startedAt");
