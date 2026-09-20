-- Staff notifications and client deletion requests.
--
-- Deleting a client destroys records other people rely on, so the permission to
-- ask for a deletion and the permission to carry one out are now separate:
-- anyone who can maintain a client may raise a request, and only a holder of
-- clients:delete may approve it. Approvers are told there is something waiting
-- through the notifications table, which is the first real backing for the bell
-- in the header (it previously rendered placeholder rows).
--
-- Note: "notifications" here is staff-facing and in-app. It is unrelated to
-- NotificationService, which delivers SMS and email outward to clients.
--
-- Every statement is guarded, so this file is safe to run more than once.
-- Apply it with: npx tsx scripts/run-notifications-migration.ts

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "notifications" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "recipientId"    TEXT NOT NULL,
  "type"           TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "link"           TEXT,
  "resource"       TEXT,
  "resourceId"     TEXT,
  "readAt"         TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- The inbox query: this recipient's unread, newest first.
CREATE INDEX IF NOT EXISTS "notifications_recipientId_readAt_idx"
  ON "notifications" ("recipientId", "readAt");
CREATE INDEX IF NOT EXISTS "notifications_recipientId_createdAt_idx"
  ON "notifications" ("recipientId", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_organizationId_createdAt_idx"
  ON "notifications" ("organizationId", "createdAt");
-- Used to clear a subject's notifications once it is resolved.
CREATE INDEX IF NOT EXISTS "notifications_resource_resourceId_idx"
  ON "notifications" ("resource", "resourceId");

ALTER TABLE "notifications"
  DROP CONSTRAINT IF EXISTS "notifications_organizationId_fkey";

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  DROP CONSTRAINT IF EXISTS "notifications_recipientId_fkey";

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- client_deletion_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "client_deletion_requests" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "requestedById"  TEXT NOT NULL,
  "reason"         TEXT,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedById"   TEXT,
  "reviewedAt"     TIMESTAMP(3),
  "reviewNotes"    TEXT,
  -- What the client looked like at approval, so the audit trail still means
  -- something once the row itself is gone.
  "clientSnapshot" JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "client_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "client_deletion_requests_organizationId_status_idx"
  ON "client_deletion_requests" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "client_deletion_requests_clientId_status_idx"
  ON "client_deletion_requests" ("clientId", "status");
CREATE INDEX IF NOT EXISTS "client_deletion_requests_requestedById_idx"
  ON "client_deletion_requests" ("requestedById");

ALTER TABLE "client_deletion_requests"
  DROP CONSTRAINT IF EXISTS "client_deletion_requests_organizationId_fkey";

ALTER TABLE "client_deletion_requests"
  ADD CONSTRAINT "client_deletion_requests_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The request goes when the client does: an approved deletion removes both,
-- and the audit log is what survives.
ALTER TABLE "client_deletion_requests"
  DROP CONSTRAINT IF EXISTS "client_deletion_requests_clientId_fkey";

ALTER TABLE "client_deletion_requests"
  ADD CONSTRAINT "client_deletion_requests_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_deletion_requests"
  DROP CONSTRAINT IF EXISTS "client_deletion_requests_requestedById_fkey";

ALTER TABLE "client_deletion_requests"
  ADD CONSTRAINT "client_deletion_requests_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "client_deletion_requests"
  DROP CONSTRAINT IF EXISTS "client_deletion_requests_reviewedById_fkey";

ALTER TABLE "client_deletion_requests"
  ADD CONSTRAINT "client_deletion_requests_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
