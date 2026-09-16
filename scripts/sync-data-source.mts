/**
 * Manual, explicit sync of one DataSource from the command line. Never runs
 * as part of test, build, lint, typecheck or seed. Use it to smoke-test a
 * live provider once its credentials exist:
 *
 *   npm run sync:manual -- ds-tennis-sportradar
 *
 * Reads .env.local / .env like the Prisma CLI, runs exactly the pipeline the
 * Admin "Sync now" action runs, prints a summary and the sync log id, and
 * exits non-zero on FAILED. Credentials are never printed.
 */
import { existsSync } from "node:fs"

import { PrismaPg } from "@prisma/adapter-pg"

import { createSyncRepository } from "../lib/data/repositories/sync-ops"
import { describeDataSourceProvider } from "../lib/data/sync/providers/registry"
import { runSync } from "../lib/data/sync/sync-core"
import { PrismaClient } from "../lib/generated/prisma/client"

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}

const dataSourceId = process.argv[2]
if (!dataSourceId) {
  console.error("Usage: npm run sync:manual -- <dataSourceId>   (e.g. ds-tennis-sportradar, ds-mock-basketball)")
  process.exit(2)
}

const binding = describeDataSourceProvider(dataSourceId)
if (!binding) {
  console.error(`No provider is bound to "${dataSourceId}". Bound sources: see lib/data/sync/providers/registry.ts.`)
  process.exit(2)
}
console.log(`Provider: ${binding.name} (${binding.key}, ${binding.kind}) for sport "${binding.sport}"`)
if (!binding.configuration.configured) {
  console.error(`Not configured: ${binding.configuration.error}`)
  process.exit(2)
}
if (binding.kind === "live") console.log("This will call the external API with the credentials from your environment.")

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set.")
  process.exit(2)
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
try {
  const result = await runSync(createSyncRepository(prisma), dataSourceId)
  console.log(`Status: ${result.status}${result.errorKind ? ` (${result.errorKind})` : ""}`)
  console.log(`Records: ${result.records} in ${result.durationMs} ms`)
  for (const [entity, c] of Object.entries(result.counts)) console.log(`  ${entity.padEnd(8)} created ${c.created}  updated ${c.updated}  failed ${c.failed}`)
  if (result.error) console.log(`Error: ${result.error}`)
  if (result.issues.length > 0) {
    console.log(`Issues (${result.issues.length}):`)
    for (const issue of result.issues.slice(0, 20)) console.log(`  ${issue.level.toUpperCase()} ${issue.entity}${issue.externalId ? ` ${issue.externalId}` : ""}: ${issue.message}`)
    if (result.issues.length > 20) console.log(`  … ${result.issues.length - 20} more in the sync log`)
  }
  console.log(`Sync log: ${result.syncLogId ?? "(none)"} → Admin → Sync Logs`)
  process.exitCode = result.status === "FAILED" ? 1 : 0
} finally {
  await prisma.$disconnect()
}
