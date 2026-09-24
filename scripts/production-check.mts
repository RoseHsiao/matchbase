import { existsSync, readdirSync } from "node:fs"

import { evaluateProductionReadiness, type ReadinessCheck } from "../lib/env/production-config"
import { resolveRuntimeEnvironment } from "../lib/env/runtime-environment"

/**
 * Deployment readiness check for operators:
 *
 *   npm run production:check            configuration only (no network, no database)
 *   npm run production:check -- --db    plus read-only database checks with the RUNTIME credential
 *   npm run production:check -- --env production   evaluate as if VERCEL_ENV were production
 *
 * Prints one line per check with PASS / WARN / FAIL / info. Never prints a
 * secret, a connection string or a hostname's credentials. Never writes to
 * the database and never calls a provider. Exit code 1 when any check fails
 * for the evaluated environment, 0 otherwise.
 *
 * Run it in an operator shell that holds the target environment's database
 * URLs and label (Vercel's sensitive variables cannot be pulled, so the
 * operator keeps a git-ignored file outside the repository with values from
 * Neon; see docs/deployment/production-deployment.md step 10). In such a
 * shell the auth and cron secrets are absent by design and those two checks
 * fail; the same evaluation runs at server startup (instrumentation.ts),
 * where the real values are present and a failing check stops Production.
 */

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file)
  } catch {
    // Optional: deployment shells inject variables directly.
  }
}

const args = process.argv.slice(2)
const withDb = args.includes("--db")
const envIndex = args.indexOf("--env")
const env: Record<string, string | undefined> = { ...process.env }
if (envIndex >= 0) {
  const value = args[envIndex + 1]
  if (!value || !["production", "preview", "development"].includes(value)) {
    console.error("--env expects production | preview | development")
    process.exit(2)
  }
  env.VERCEL_ENV = value
}

const report = evaluateProductionReadiness(env)
const label = (check: ReadinessCheck) => ({ pass: "PASS", warn: "WARN", fail: "FAIL", info: "info" })[check.status]
console.log(`MatchBase readiness for ${report.environment} (${report.platform})`)
for (const check of report.checks) console.log(`  ${label(check).padEnd(4)} ${check.id}: ${check.detail}`)

let dbFailures = 0
if (withDb) {
  console.log("\nDatabase (read-only, runtime credential DATABASE_URL):")
  const connectionString = env.DATABASE_URL
  if (!connectionString) {
    console.log("  FAIL db: DATABASE_URL is not set.")
    dbFailures++
  } else {
    const { PrismaPg } = await import("@prisma/adapter-pg")
    const { PrismaClient } = await import("../lib/generated/prisma/client")
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
    try {
      const [who] = await prisma.$queryRaw<{ role: string; create_on_schema: boolean; is_owner: boolean }[]>`
        SELECT current_user::text AS role,
               has_schema_privilege(current_user, 'public', 'CREATE') AS create_on_schema,
               (SELECT pg_get_userbyid(datdba) = current_user FROM pg_database WHERE datname = current_database()) AS is_owner`
      console.log(`  PASS db-connect: connected as role "${who.role}".`)
      if (who.is_owner || who.create_on_schema) {
        console.log(`  WARN db-privileges: the runtime role ${who.is_owner ? "owns the database" : "can CREATE in schema public"}; Production should use the least-privilege runtime role (prisma/sql/runtime-role.sql).`)
      } else {
        console.log("  PASS db-privileges: the runtime role cannot alter the schema.")
      }
      const local = existsSync("prisma/migrations") ? readdirSync("prisma/migrations").filter((name) => /^\d{14}_/.test(name)).sort() : []
      const [ledger] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations'`
      // A database that was never migrated has no ledger table; that is a defined state (9.3B applies everything), not an error.
      const applied = ledger.n === 0 ? [] : await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`
      if (ledger.n === 0) console.log(`  info db-ledger: no _prisma_migrations table; the database has never been migrated.`)
      const appliedNames = new Set(applied.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name))
      const pending = local.filter((name) => !appliedNames.has(name))
      const failed = applied.filter((row) => !row.finished_at && !row.rolled_back_at)
      if (failed.length > 0) {
        console.log(`  FAIL db-migrations: ${failed.length} migration(s) recorded as started but not finished: ${failed.map((row) => row.migration_name).join(", ")} (resolve with prisma migrate resolve).`)
        dbFailures++
      } else if (pending.length > 0) {
        console.log(`  FAIL db-migrations: ${pending.length} migration(s) not applied: ${pending.join(", ")}. Run npm run db:migrate before deploying.`)
        dbFailures++
      } else {
        console.log(`  PASS db-migrations: all ${local.length} migrations applied.`)
      }
      const [tables] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('User','Session','Account','Verification','RateLimit','DataSource','SyncLog')`
      console.log(`  ${tables.n === 7 ? "PASS" : "FAIL"} db-schema: ${tables.n} of 7 expected auth and sync tables present.`)
      if (tables.n !== 7) dbFailures++
      if (tables.n === 0) {
        console.log("  info db-empty: no application tables; the remaining table checks are skipped until migrations run.")
      } else {
        const [running] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "SyncLog" WHERE status = 'RUNNING' AND "startedAt" < now() - interval '15 minutes'`
        console.log(`  ${running.n === 0 ? "PASS" : "WARN"} db-sync-locks: ${running.n} stale RUNNING sync log(s) (the next run recovers them).`)
        const [admins] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "User" WHERE role = 'ADMIN'`
        console.log(`  ${admins.n > 0 ? "PASS" : "WARN"} db-admins: ${admins.n} administrator account(s).`)
        const [demo] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "User" WHERE id = 'demo-user' OR email LIKE '%@matchbase.local'`
        if (resolveRuntimeEnvironment(env) === "production") console.log(`  ${demo.n === 0 ? "PASS" : "WARN"} db-demo-data: ${demo.n} demo or development account(s) present in a Production database.`)
        else console.log(`  info db-demo-data: ${demo.n} demo or development account(s).`)
      }
    } catch (error) {
      const line = error instanceof Error ? error.message.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? error.name : "database check failed"
      console.log(`  FAIL db: ${line.slice(0, 200)}`)
      dbFailures++
    } finally {
      await prisma.$disconnect()
    }
  }
}

const failures = report.failures.length + dbFailures
console.log(`\n${failures === 0 ? "READY" : "NOT READY"}: ${report.failures.length} configuration failure(s), ${report.warnings.length} warning(s)${withDb ? `, ${dbFailures} database failure(s)` : ""}.`)
process.exit(failures === 0 ? 0 : 1)
