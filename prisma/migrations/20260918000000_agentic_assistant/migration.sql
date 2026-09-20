-- Agentic Assistant: settings, conversations, runs, approvals, automations,
-- connected mailboxes, browser logins, MCP servers, API connectors, usage and
-- memory.
--
-- The assistant acts on behalf of a member of staff, so every table carries
-- the organization it belongs to and, where an action was taken, the person
-- whose authority it was taken with.

CREATE TABLE IF NOT EXISTS "assistant_settings" (
  "id"                    TEXT PRIMARY KEY,
  "organizationId"        TEXT NOT NULL UNIQUE,
  "enabled"               BOOLEAN NOT NULL DEFAULT false,
  "providerName"          TEXT,
  "modelName"             TEXT,
  "capabilities"          JSONB,
  "instructions"          TEXT,
  "maxStepsPerRun"        INTEGER NOT NULL DEFAULT 12,
  "monthlyTokenBudget"    INTEGER,
  "dailyRunLimit"         INTEGER NOT NULL DEFAULT 200,
  "timezone"              TEXT NOT NULL DEFAULT 'Africa/Harare',
  "workingHours"          JSONB,
  "memoryEnabled"         BOOLEAN NOT NULL DEFAULT true,
  "whatsappEnabled"       BOOLEAN NOT NULL DEFAULT false,
  "whatsappConfig"        JSONB,
  "browserAllowedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedById"           TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "assistant_conversations" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT,
  "clientId"       TEXT,
  "title"          TEXT,
  "channel"        TEXT NOT NULL DEFAULT 'APP',
  "context"        JSONB,
  "verifiedUntil"  TIMESTAMP(3),
  "handoffUntil"   TIMESTAMP(3),
  "archivedAt"     TIMESTAMP(3),
  "lastMessageAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assistant_conversations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_conversations_org_user_idx" ON "assistant_conversations"("organizationId", "userId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "assistant_conversations_org_client_idx" ON "assistant_conversations"("organizationId", "clientId", "lastMessageAt");

CREATE TABLE IF NOT EXISTS "assistant_messages" (
  "id"             TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "role"           TEXT NOT NULL,
  "content"        TEXT NOT NULL DEFAULT '',
  "parts"          JSONB,
  "providerData"   JSONB,
  "attachments"    JSONB,
  "runId"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_messages_conversationId_createdAt_idx" ON "assistant_messages"("conversationId", "createdAt");

CREATE TABLE IF NOT EXISTS "assistant_runs" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "conversationId"  TEXT,
  "trigger"         TEXT NOT NULL DEFAULT 'CHAT',
  "actingUserId"    TEXT,
  "automationId"    TEXT,
  "automationRunId" TEXT,
  "status"          TEXT NOT NULL DEFAULT 'QUEUED',
  "input"           JSONB,
  "provider"        TEXT,
  "model"           TEXT,
  "steps"           INTEGER NOT NULL DEFAULT 0,
  "inputTokens"     INTEGER NOT NULL DEFAULT 0,
  "outputTokens"    INTEGER NOT NULL DEFAULT 0,
  "tainted"         BOOLEAN NOT NULL DEFAULT false,
  "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
  "error"           TEXT,
  "summary"         TEXT,
  "lockedAt"        TIMESTAMP(3),
  "heartbeatAt"     TIMESTAMP(3),
  "startedAt"       TIMESTAMP(3),
  "completedAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_runs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_runs_actingUserId_fkey" FOREIGN KEY ("actingUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_runs_status_createdAt_idx" ON "assistant_runs"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "assistant_runs_organizationId_createdAt_idx" ON "assistant_runs"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "assistant_runs_conversationId_createdAt_idx" ON "assistant_runs"("conversationId", "createdAt");

CREATE TABLE IF NOT EXISTS "assistant_run_steps" (
  "id"         TEXT PRIMARY KEY,
  "runId"      TEXT NOT NULL,
  "index"      INTEGER NOT NULL,
  "type"       TEXT NOT NULL,
  "toolName"   TEXT,
  "capability" TEXT,
  "status"     TEXT NOT NULL DEFAULT 'OK',
  "summary"    TEXT,
  "input"      JSONB,
  "output"     JSONB,
  "durationMs" INTEGER,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_run_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "assistant_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_run_steps_runId_index_idx" ON "assistant_run_steps"("runId", "index");

CREATE TABLE IF NOT EXISTS "assistant_approvals" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "runId"          TEXT,
  "conversationId" TEXT,
  "automationId"   TEXT,
  "capability"     TEXT NOT NULL,
  "toolName"       TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "summary"        TEXT,
  "action"         JSONB NOT NULL,
  "editableFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "preview"        JSONB,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "requestedById"  TEXT,
  "decidedById"    TEXT,
  "decidedAt"      TIMESTAMP(3),
  "decisionNote"   TEXT,
  "result"         JSONB,
  "error"          TEXT,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "expiresAt"      TIMESTAMP(3),
  "executedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_approvals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_approvals_runId_fkey" FOREIGN KEY ("runId") REFERENCES "assistant_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assistant_approvals_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assistant_approvals_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_approvals_org_status_idx" ON "assistant_approvals"("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "assistant_approvals_runId_idx" ON "assistant_approvals"("runId");

CREATE TABLE IF NOT EXISTS "assistant_artifacts" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "conversationId" TEXT,
  "runId"          TEXT,
  "kind"           TEXT NOT NULL DEFAULT 'ATTACHMENT',
  "fileName"       TEXT NOT NULL,
  "mimeType"       TEXT NOT NULL,
  "fileSize"       INTEGER NOT NULL DEFAULT 0,
  "storagePath"    TEXT NOT NULL,
  "metadata"       JSONB,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_artifacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_artifacts_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assistant_artifacts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_artifacts_org_createdAt_idx" ON "assistant_artifacts"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "assistant_artifacts_conversationId_idx" ON "assistant_artifacts"("conversationId");

CREATE TABLE IF NOT EXISTS "assistant_automations" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "type"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "enabled"        BOOLEAN NOT NULL DEFAULT false,
  "schedule"       JSONB NOT NULL,
  "timezone"       TEXT NOT NULL DEFAULT 'Africa/Harare',
  "config"         JSONB,
  "dryRun"         BOOLEAN NOT NULL DEFAULT true,
  "ownerId"        TEXT NOT NULL,
  "branchId"       TEXT,
  "nextRunAt"      TIMESTAMP(3),
  "lastRunAt"      TIMESTAMP(3),
  "lastStatus"     TEXT,
  "lastError"      TEXT,
  "lockedAt"       TIMESTAMP(3),
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_automations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_automations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_automations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assistant_automations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_automations_enabled_nextRunAt_idx" ON "assistant_automations"("enabled", "nextRunAt");
CREATE INDEX IF NOT EXISTS "assistant_automations_org_type_idx" ON "assistant_automations"("organizationId", "type");

CREATE TABLE IF NOT EXISTS "assistant_automation_runs" (
  "id"             TEXT PRIMARY KEY,
  "automationId"   TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "trigger"        TEXT NOT NULL DEFAULT 'SCHEDULE',
  "status"         TEXT NOT NULL DEFAULT 'RUNNING',
  "dryRun"         BOOLEAN NOT NULL DEFAULT false,
  "summary"        TEXT,
  "stats"          JSONB,
  "error"          TEXT,
  "runId"          TEXT,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3),
  CONSTRAINT "assistant_automation_runs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "assistant_automations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_automation_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_automation_runs_automationId_idx" ON "assistant_automation_runs"("automationId", "startedAt");
CREATE INDEX IF NOT EXISTS "assistant_automation_runs_org_idx" ON "assistant_automation_runs"("organizationId", "startedAt");

CREATE TABLE IF NOT EXISTS "assistant_connections" (
  "id"                   TEXT PRIMARY KEY,
  "organizationId"       TEXT NOT NULL,
  "toolkit"              TEXT NOT NULL,
  "label"                TEXT,
  "accountLabel"         TEXT,
  "composioUserId"       TEXT NOT NULL UNIQUE,
  "composioAuthConfigId" TEXT,
  "composioAccountId"    TEXT,
  "status"               TEXT NOT NULL DEFAULT 'INITIATED',
  "triggerId"            TEXT,
  "lastSyncAt"           TIMESTAMP(3),
  "lastError"            TEXT,
  "connectedById"        TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_connections_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_connections_org_toolkit_idx" ON "assistant_connections"("organizationId", "toolkit");

CREATE TABLE IF NOT EXISTS "assistant_processed_emails" (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "connectionId"      TEXT NOT NULL,
  "purpose"           TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "outcome"           TEXT,
  "clientId"          TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_processed_emails_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_processed_emails_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "assistant_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_processed_emails_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_processed_emails_unique" ON "assistant_processed_emails"("connectionId", "purpose", "providerMessageId");
CREATE INDEX IF NOT EXISTS "assistant_processed_emails_org_idx" ON "assistant_processed_emails"("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "assistant_outreach" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "automationId"   TEXT,
  "loanId"         TEXT,
  "clientId"       TEXT,
  "channel"        TEXT,
  "messageId"      TEXT,
  "dedupeKey"      TEXT NOT NULL UNIQUE,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_outreach_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_outreach_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "assistant_automations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assistant_outreach_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assistant_outreach_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "assistant_outreach_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "client_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_outreach_org_idx" ON "assistant_outreach"("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "assistant_browser_logins" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "domain"           TEXT NOT NULL,
  "loginUrl"         TEXT NOT NULL,
  "username"         TEXT NOT NULL,
  "secret"           TEXT NOT NULL,
  "usernameSelector" TEXT,
  "passwordSelector" TEXT,
  "submitSelector"   TEXT,
  "storageState"     TEXT,
  "status"           TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "lastVerifiedAt"   TIMESTAMP(3),
  "lastError"        TEXT,
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_browser_logins_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_browser_logins_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_browser_logins_org_domain_idx" ON "assistant_browser_logins"("organizationId", "domain");

CREATE TABLE IF NOT EXISTS "assistant_mcp_servers" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "url"            TEXT NOT NULL,
  "authHeaderName" TEXT,
  "authSecret"     TEXT,
  "enabled"        BOOLEAN NOT NULL DEFAULT false,
  "toolPolicy"     JSONB,
  "toolCache"      JSONB,
  "status"         TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "lastCheckedAt"  TIMESTAMP(3),
  "lastError"      TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_mcp_servers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_mcp_servers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_mcp_servers_org_enabled_idx" ON "assistant_mcp_servers"("organizationId", "enabled");

CREATE TABLE IF NOT EXISTS "assistant_api_connectors" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "baseUrl"        TEXT NOT NULL,
  "authType"       TEXT NOT NULL DEFAULT 'NONE',
  "authHeaderName" TEXT,
  "secret"         TEXT,
  "allowWrite"     BOOLEAN NOT NULL DEFAULT false,
  "enabled"        BOOLEAN NOT NULL DEFAULT true,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_api_connectors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_api_connectors_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_api_connectors_org_enabled_idx" ON "assistant_api_connectors"("organizationId", "enabled");

CREATE TABLE IF NOT EXISTS "assistant_usage" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "day"            DATE NOT NULL,
  "provider"       TEXT NOT NULL,
  "model"          TEXT NOT NULL,
  "runs"           INTEGER NOT NULL DEFAULT 0,
  "requests"       INTEGER NOT NULL DEFAULT 0,
  "inputTokens"    INTEGER NOT NULL DEFAULT 0,
  "outputTokens"   INTEGER NOT NULL DEFAULT 0,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_usage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_usage_org_day_model_key" ON "assistant_usage"("organizationId", "day", "provider", "model");
CREATE INDEX IF NOT EXISTS "assistant_usage_org_day_idx" ON "assistant_usage"("organizationId", "day");

CREATE TABLE IF NOT EXISTS "assistant_memories" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "scope"          TEXT NOT NULL DEFAULT 'ORG',
  "userId"         TEXT,
  "content"        TEXT NOT NULL,
  "source"         TEXT NOT NULL DEFAULT 'USER',
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_memories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assistant_memories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "assistant_memories_org_scope_idx" ON "assistant_memories"("organizationId", "scope");
