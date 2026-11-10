-- Email verification becomes required for new email/password accounts. Accounts that existed before
-- this release (customers, staff, the owner) are treated as verified so nobody is locked out.
-- Data-only migration; no schema change.
UPDATE "user" SET "emailVerified" = true, "updatedAt" = NOW() WHERE "emailVerified" = false;
