-- Client communications: email, SMS and WhatsApp messages, broadcasts,
-- reusable templates and per-channel opt-outs.
CREATE TABLE IF NOT EXISTS "message_broadcasts" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "channel"          TEXT NOT NULL,
  "subject"          TEXT,
  "body"             TEXT NOT NULL,
  "templateName"     TEXT,
  "templateLanguage" TEXT,
  "templateParams"   JSONB,
  "audience"         JSONB NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'QUEUED',
  "totalRecipients"  INTEGER NOT NULL DEFAULT 0,
  "skippedCount"     INTEGER NOT NULL DEFAULT 0,
  "createdById"      TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"      TIMESTAMP(3),
  "cancelledAt"      TIMESTAMP(3),
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "message_broadcasts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "message_broadcasts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "message_broadcasts_organizationId_createdAt_idx" ON "message_broadcasts"("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "client_messages" (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "clientId"          TEXT,
  "loanId"            TEXT,
  "broadcastId"       TEXT,
  "channel"           TEXT NOT NULL,
  "provider"          TEXT NOT NULL,
  "direction"         TEXT NOT NULL DEFAULT 'OUTBOUND',
  "toAddress"         TEXT NOT NULL,
  "fromAddress"       TEXT,
  "subject"           TEXT,
  "body"              TEXT NOT NULL,
  "templateName"      TEXT,
  "templateLanguage"  TEXT,
  "templateParams"    JSONB,
  "status"            TEXT NOT NULL DEFAULT 'QUEUED',
  "providerMessageId" TEXT,
  "errorCode"         TEXT,
  "errorMessage"      TEXT,
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt"          TIMESTAMP(3),
  "sentById"          TEXT,
  "queuedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"            TIMESTAMP(3),
  "deliveredAt"       TIMESTAMP(3),
  "readAt"            TIMESTAMP(3),
  "failedAt"          TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "client_messages_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "client_messages_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "client_messages_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "message_broadcasts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "client_messages_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "client_messages_organizationId_clientId_createdAt_idx" ON "client_messages"("organizationId", "clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "client_messages_organizationId_createdAt_idx" ON "client_messages"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "client_messages_loanId_createdAt_idx" ON "client_messages"("loanId", "createdAt");
CREATE INDEX IF NOT EXISTS "client_messages_broadcastId_status_idx" ON "client_messages"("broadcastId", "status");
CREATE INDEX IF NOT EXISTS "client_messages_status_nextAttemptAt_idx" ON "client_messages"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "client_messages_provider_providerMessageId_idx" ON "client_messages"("provider", "providerMessageId");

CREATE TABLE IF NOT EXISTS "message_templates" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "channel"        TEXT NOT NULL DEFAULT 'ANY',
  "subject"        TEXT,
  "body"           TEXT NOT NULL,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdById"    TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "message_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "message_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "message_templates_organizationId_name_key" ON "message_templates"("organizationId", "name");

CREATE TABLE IF NOT EXISTS "client_communication_preferences" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "emailOptOut"    BOOLEAN NOT NULL DEFAULT false,
  "smsOptOut"      BOOLEAN NOT NULL DEFAULT false,
  "whatsappOptOut" BOOLEAN NOT NULL DEFAULT false,
  "source"         TEXT,
  "note"           TEXT,
  "updatedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_communication_preferences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "client_communication_preferences_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "client_communication_preferences_clientId_key" ON "client_communication_preferences"("clientId");
