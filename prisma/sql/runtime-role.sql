-- Least-privilege runtime role for the MatchBase application (Phase 9.2; verified
-- against the migrated Production schema in Phase 9.3B, 2026-09-23).
--
-- Run ONCE per database as the OWNER / migration role (neondb_owner, the role in
-- DATABASE_URL_UNPOOLED), AFTER the migrations have been applied: the grants below
-- refer to existing tables. Roles created with SQL on Neon are ordinary roles
-- without neon_superuser membership (Neon "Manage roles", verified 2026-09-18).
--
-- The only placeholder is the password. Replace __RUNTIME_PASSWORD__ with a value
-- generated for this purpose (for example `openssl rand -hex 24`: 48 URL-safe
-- characters, 192 bits; Neon requires at least 60 bits of entropy). Never commit,
-- paste into chat, or leave the filled-in file on disk; see
-- docs/deployment/production-deployment.md step 2 for the psql procedure.
--
-- What the runtime needs (inventory in docs/security/production-hardening.md):
-- SELECT, INSERT, UPDATE, DELETE on every table (Prisma queries, Better Auth,
-- the sync pipeline's upserts, SELECT ... FOR UPDATE on DataSource), USAGE on the
-- schema, USAGE on types (granted to PUBLIC by PostgreSQL), and SELECT on the
-- migration ledger so `production:check --db` can read it with the runtime
-- credential. It never needs CREATE, ownership, or writes to _prisma_migrations;
-- migrations stay with the owner role. There are no sequences, views or
-- functions in the schema today; the sequence grants are for future migrations.

-- The role: login only. No superuser, no CREATEDB, no CREATEROLE, no BYPASSRLS,
-- no REPLICATION; it owns nothing.
CREATE ROLE matchbase_app WITH LOGIN PASSWORD '__RUNTIME_PASSWORD__'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;

GRANT CONNECT ON DATABASE neondb TO matchbase_app;
GRANT USAGE ON SCHEMA public TO matchbase_app;

-- Existing tables (created by the migrations already applied): every application
-- table gets the four data privileges; the migration ledger is deliberately left out
-- of the loop and receives SELECT only. Granting on "ALL TABLES" and revoking the
-- ledger afterwards was the previous form; on 2026-09-23 a Production run ended
-- with the ledger still writable, so the script no longer depends on a later REVOKE.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO matchbase_app', t);
  END LOOP;
END
$$;
GRANT SELECT ON TABLE public."_prisma_migrations" TO matchbase_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO matchbase_app;

-- Tables that FUTURE migrations create. ALTER DEFAULT PRIVILEGES applies to objects
-- created by the role executing this statement, which is the owner/migration role,
-- exactly the role that runs `prisma migrate deploy`. (_prisma_migrations already
-- exists, so these rules never touch it.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO matchbase_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO matchbase_app;

-- Self-check: the script fails loudly if the outcome is not least privilege, so a
-- partial or reordered run cannot pass silently.
DO $$
BEGIN
  IF has_table_privilege('matchbase_app', 'public."_prisma_migrations"', 'INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'matchbase_app can write the migration ledger';
  END IF;
  IF NOT has_table_privilege('matchbase_app', 'public."_prisma_migrations"', 'SELECT') THEN
    RAISE EXCEPTION 'matchbase_app cannot read the migration ledger';
  END IF;
  IF has_schema_privilege('matchbase_app', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'matchbase_app can CREATE in schema public';
  END IF;
  IF NOT has_table_privilege('matchbase_app', 'public."User"', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'matchbase_app lacks data privileges on application tables';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'matchbase_app' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)) THEN
    RAISE EXCEPTION 'matchbase_app has an administrative role attribute';
  END IF;
END
$$;

-- Manual verification (as neondb_owner; every row must read as noted):
--   SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolcanlogin
--     FROM pg_roles WHERE rolname = 'matchbase_app';            -- f f f f t
--   SELECT has_schema_privilege('matchbase_app', 'public', 'CREATE');          -- f
--   SELECT has_table_privilege('matchbase_app', '"User"', 'SELECT,INSERT,UPDATE,DELETE');   -- t
--   SELECT has_table_privilege('matchbase_app', '"_prisma_migrations"', 'INSERT');          -- f
--   SELECT has_table_privilege('matchbase_app', '"_prisma_migrations"', 'SELECT');          -- t
--
-- Then build the Production DATABASE_URL from this role and the POOLED host
-- (…-pooler.…neon.tech) with ?sslmode=verify-full, replace only that Vercel
-- Production variable, and keep DATABASE_URL_UNPOOLED on the owner role and the
-- direct host.
