import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { describe, it } from "node:test"

import { evaluateRuntimeTablePrivileges, REQUIRED_TABLES, type TablePrivilegeRow } from "../../lib/env/db-readiness"

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}
const url = process.env.DATABASE_URL
const itDb = url ? it : it.skip

const full = (table: string): TablePrivilegeRow => ({ table, select: true, insert: true, update: true, delete: true })
const allTables = [...REQUIRED_TABLES, "Match", "Team"].map(full)
const byId = (rows: TablePrivilegeRow[], id: string) => evaluateRuntimeTablePrivileges(rows).find((check) => check.id === id)

describe("runtime table privileges (pure evaluation)", () => {
  it("passes when every expected table exists and every table has SELECT, INSERT, UPDATE and DELETE", () => {
    assert.equal(byId(allTables, "db-schema")?.status, "pass")
    assert.equal(byId(allTables, "db-table-privileges")?.status, "pass")
  })

  it("fails before the notification migration: NotificationDelivery is missing", () => {
    const check = byId(allTables.filter((row) => row.table !== "NotificationDelivery"), "db-schema")
    assert.equal(check?.status, "fail")
    assert.match(check?.detail ?? "", /NotificationDelivery.*db:migrate.*before deploying/)
  })

  it("fails, naming table and privilege, when the default privileges did not reach a new table", () => {
    const rows = allTables.map((row) => (row.table === "NotificationDelivery" ? { ...row, insert: false, update: false } : row))
    const check = byId(rows, "db-table-privileges")
    assert.equal(check?.status, "fail")
    assert.match(check?.detail ?? "", /NotificationDelivery \(INSERT, UPDATE\).*runtime-role\.sql.*never grants/)
  })

  it("fails when no table is visible, so privileges cannot be verified", () => {
    assert.equal(byId([], "db-table-privileges")?.status, "fail")
  })
})

describe("production:check --db (development database, read-only)", () => {
  itDb("reports the expected tables and the connected role's table privileges", () => {
    const result = spawnSync("npx", ["tsx", "scripts/production-check.mts", "--db"], { encoding: "utf8", env: process.env })
    const out = `${result.stdout}${result.stderr}`
    assert.match(out, /PASS db-schema: All \d+ expected application tables are present, including NotificationDelivery\./)
    assert.match(out, /PASS db-table-privileges: The runtime role holds SELECT, INSERT, UPDATE, DELETE on all \d+ application tables\./)
    assert.doesNotMatch(out, /postgres(ql)?:\/\/|npg_/, "no connection string or password")
  })
})
