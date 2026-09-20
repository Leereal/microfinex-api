-- Discussion threads on clients and loans.
--
-- Edits are marked, deletions hide a message instead of erasing it, and each
-- person's read position drives the unread counts on the list screens.
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;

CREATE INDEX IF NOT EXISTS "notes_organizationId_entityType_entityId_createdAt_idx"
  ON "notes"("organizationId", "entityType", "entityId", "createdAt");

CREATE TABLE IF NOT EXISTS "note_read_markers" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "entityType"     "NoteEntityType" NOT NULL,
  "entityId"       TEXT NOT NULL,
  "lastReadAt"     TIMESTAMP(3) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "note_read_markers_userId_entityType_entityId_key"
  ON "note_read_markers"("userId", "entityType", "entityId");
CREATE INDEX IF NOT EXISTS "note_read_markers_organizationId_entityType_entityId_idx"
  ON "note_read_markers"("organizationId", "entityType", "entityId");
