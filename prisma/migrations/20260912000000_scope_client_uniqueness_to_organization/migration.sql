-- Client uniqueness is per organization, not global.
--
-- clientNumber, phone and idNumber were unique across the whole database. For a
-- multi-tenant lender that is wrong three times over: client numbers are a
-- per-organization sequence, so one tenant's numbering consumed another's; two
-- lenders can legitimately serve the same person, so a shared phone or national
-- ID stopped the second from registering them; and a collision revealed the
-- existence of a record in an organization the caller cannot see.
--
-- In practice this surfaced as "Could not allocate a client number": an
-- organization with one client computed the next number in its own sequence and
-- collided with another organization that already held that number.

DROP INDEX IF EXISTS "clients_clientNumber_key";
DROP INDEX IF EXISTS "clients_phone_key";
DROP INDEX IF EXISTS "clients_idNumber_key";

CREATE UNIQUE INDEX IF NOT EXISTS "clients_organizationId_clientNumber_key"
  ON "clients" ("organizationId", "clientNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "clients_organizationId_phone_key"
  ON "clients" ("organizationId", "phone");
CREATE UNIQUE INDEX IF NOT EXISTS "clients_organizationId_idNumber_key"
  ON "clients" ("organizationId", "idNumber");
