import { PrismaPg } from "@prisma/adapter-pg"

import { applySystemBootstrap } from "../lib/data/repositories/system-bootstrap-ops"
import { systemDataSources, systemSports, validateSystemBootstrap } from "../lib/data/system-bootstrap"
import { operatorPolicy } from "../lib/env/runtime-environment"
import { PrismaClient } from "../lib/generated/prisma/client"

/**
 * System bootstrap for a freshly migrated database (Phase 9.3B step 6):
 * the sport registry and one DataSource row per live provider binding.
 * No demo data, no users, no matches. Idempotent; safe to re-run after a
 * deployment that adds a sport or a provider.
 *
 *   npm run bootstrap:system                       # live providers only (Production)
 *   npm run bootstrap:system -- --include-mock     # also the mock feed (development, preview)
 *   npm run bootstrap:system -- --dry-run          # print what would be written
 *
 * Against a production-labelled database it requires
 * MATCHBASE_OPERATOR_TARGET=production. Prints ids and names only.
 */

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file)
  } catch {
    // optional
  }
}

const args = process.argv.slice(2)
const includeMock = args.includes("--include-mock")
const dryRun = args.includes("--dry-run")

const problems = validateSystemBootstrap()
if (problems.length > 0) {
  for (const problem of problems) console.error(problem)
  process.exit(2)
}

const operator = operatorPolicy(process.env)
if (!operator.allowed) {
  console.error(`Refused: ${operator.reason}`)
  process.exit(3)
}

console.log(`System bootstrap for the ${operator.target} database${dryRun ? " (dry run)" : ""}:`)
console.log(`  sports: ${systemSports().map((sport) => sport.id).join(", ")}`)
console.log(`  data sources: ${systemDataSources({ includeMock }).map((source) => `${source.id} (${source.kind})`).join(", ")}`)
if (dryRun) process.exit(0)

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set.")
  process.exit(2)
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
try {
  const summary = await prisma.$transaction((tx) => applySystemBootstrap(tx, { includeMock }), { timeout: 60_000 })
  console.log(`Done. Sports created ${summary.sports.created}, updated ${summary.sports.updated}; data sources created ${summary.dataSources.created}, updated ${summary.dataSources.updated}.`)
} catch (error) {
  console.error("Bootstrap failed:", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : String(error))
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
