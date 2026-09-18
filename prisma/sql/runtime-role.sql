-- Least-privilege runtime role for the MatchBase application (Phase 9.2).
--
-- Run ONCE per database with the OWNER / migration role (the role in
-- DATABASE_URL_UNPOOLED), after the migrations have been applied. Replace
-- the two placeholders; never commit the password. On Neon, run it in the
-- SQL Editor or with psql using the direct (non-pooled) connection; roles
-- created with SQL are ordinary roles without neon_superuser membership
-- (Neon "Manage roles", verified 2026-09-18).
--
--   :runtime_role      e.g. matchbase_app
--   :runtime_password  generated, 20+ characters (Neon requires 60 bits of entropy)
--
-- What the runtime needs (inventory in docs/security/production-hardening.md):
-- SELECT, INSERT, UPDATE, DELETE on every table (Prisma queries, Better
-- Auth, the sync pipeline's upserts, SELECT ... FOR UPDATE on DataSource),
-- USAGE on sequences (none today; harmless if added later) and USAGE on the
-- schema. It never needs CREATE, ownership, or the _prisma_migrations table
-- for writing; migrations stay with the owner role.

CREATE ROLE :runtime_role WITH LOGIN PASSWORD ':runtime_password';

GRANT CONNECT ON DATABASE neondb TO :runtime_role;          -- adjust the database name if it differs
GRANT USAGE ON SCHEMA public TO :runtime_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :runtime_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :runtime_role;

-- Tables created by FUTURE migrations (run by the owner role) get the same grants.
-- ALTER DEFAULT PRIVILEGES applies to objects created by the role running this
-- statement, which is the owner/migration role, exactly the role that creates tables.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :runtime_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :runtime_role;

-- The migration ledger is read by `production:check --db`; the runtime never writes it.
REVOKE INSERT, UPDATE, DELETE ON "_prisma_migrations" FROM :runtime_role;

-- Verify (as the runtime role): both should be false.
--   SELECT has_schema_privilege(current_user, 'public', 'CREATE');
--   SELECT pg_get_userbyid(datdba) = current_user FROM pg_database WHERE datname = current_database();
--
-- Then build the Production DATABASE_URL from this role and the POOLED host
-- (…-pooler.…neon.tech) with ?sslmode=verify-full, and keep
-- DATABASE_URL_UNPOOLED on the owner role and the direct host.
