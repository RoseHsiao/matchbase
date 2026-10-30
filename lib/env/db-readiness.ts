import type { ReadinessCheck } from "@/lib/env/production-config"

/**
 * Read-only database readiness for the runtime role (`npm run production:check -- --db`):
 * the application tables the build expects exist, and the connected role holds exactly the
 * table privileges prisma/sql/runtime-role.sql grants (SELECT, INSERT, UPDATE, DELETE on every
 * table except `_prisma_migrations`). Nothing here grants, alters or writes; a missing privilege
 * is reported for an operator to fix with the owner role.
 *
 * `has_table_privilege` is called once per privilege: given a comma-separated list it answers
 * true when *any* of them is held, which would hide a missing one.
 */

export const RUNTIME_TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const

/** Tables this build reads or writes at runtime and must find; NotificationDelivery arrives with migration 20261028080000. */
export const REQUIRED_TABLES = ["User", "Session", "Account", "Verification", "RateLimit", "DataSource", "SyncLog", "UserWatchlistMatch", "NotificationDelivery"] as const

export type TablePrivilegeRow = { table: string; select: boolean; insert: boolean; update: boolean; delete: boolean }

type RawClient = { $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> }

export async function readRuntimeTablePrivileges(prisma: RawClient): Promise<TablePrivilegeRow[]> {
  return prisma.$queryRaw<TablePrivilegeRow[]>`
    SELECT t.tablename::text AS "table",
           has_table_privilege(current_user, format('public.%I', t.tablename), 'SELECT') AS "select",
           has_table_privilege(current_user, format('public.%I', t.tablename), 'INSERT') AS "insert",
           has_table_privilege(current_user, format('public.%I', t.tablename), 'UPDATE') AS "update",
           has_table_privilege(current_user, format('public.%I', t.tablename), 'DELETE') AS "delete"
    FROM pg_tables t
    WHERE t.schemaname = 'public' AND t.tablename <> '_prisma_migrations'
    ORDER BY t.tablename`
}

/** Names only: never a value, never a connection string. */
export function evaluateRuntimeTablePrivileges(rows: readonly TablePrivilegeRow[]): ReadinessCheck[] {
  const present = new Set(rows.map((row) => row.table))
  const missingTables = REQUIRED_TABLES.filter((table) => !present.has(table))
  const checks: ReadinessCheck[] = []
  if (missingTables.length > 0) {
    checks.push({ id: "db-schema", status: "fail", detail: `Missing table(s): ${missingTables.join(", ")}. Apply the pending migrations (npm run db:migrate with the owner role) before deploying this build.` })
  } else {
    checks.push({ id: "db-schema", status: "pass", detail: `All ${REQUIRED_TABLES.length} expected application tables are present, including NotificationDelivery.` })
  }
  const lacking = rows.flatMap((row) => {
    const missing = RUNTIME_TABLE_PRIVILEGES.filter((privilege) => !row[privilege.toLowerCase() as "select" | "insert" | "update" | "delete"])
    return missing.length > 0 ? [`${row.table} (${missing.join(", ")})`] : []
  })
  if (rows.length === 0) {
    checks.push({ id: "db-table-privileges", status: "fail", detail: "No application tables are visible to the runtime role; table privileges cannot be verified." })
  } else if (lacking.length > 0) {
    checks.push({ id: "db-table-privileges", status: "fail", detail: `The runtime role lacks privileges on: ${lacking.join("; ")}. As the owner role, re-run the table grants in prisma/sql/runtime-role.sql; this check never grants anything.` })
  } else {
    checks.push({ id: "db-table-privileges", status: "pass", detail: `The runtime role holds ${RUNTIME_TABLE_PRIVILEGES.join(", ")} on all ${rows.length} application tables.` })
  }
  return checks
}
