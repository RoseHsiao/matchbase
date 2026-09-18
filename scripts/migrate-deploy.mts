import { spawnSync } from "node:child_process"

import { databaseLabelPolicy, operatorPolicy } from "../lib/env/runtime-environment"

/**
 * Production-safe migration deployment: `prisma migrate deploy` behind the
 * operator guards. This is the only migration command the runbook uses
 * against Production.
 *
 *   npm run db:migrate                         # development or preview database
 *   MATCHBASE_OPERATOR_TARGET=production npm run db:migrate   # production-labelled database
 *
 * - never `migrate dev`, never `db push`, never a reset;
 * - uses the direct connection (DATABASE_URL_UNPOOLED via prisma.config.ts);
 * - refuses a production-labelled database without the operator confirmation;
 * - prints migration names, never a connection string.
 */

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file)
  } catch {
    // optional
  }
}

if (process.argv.slice(2).some((arg) => /reset|push|dev/.test(arg))) {
  console.error("This command only applies pending migrations. Resets and pushes are never run against a deployed database.")
  process.exit(2)
}
if (!process.env.DATABASE_URL_UNPOOLED) {
  console.error("DATABASE_URL_UNPOOLED is not set; migrations use the direct connection.")
  process.exit(2)
}
const operator = operatorPolicy(process.env)
if (!operator.allowed) {
  console.error(`Migration refused: ${operator.reason}`)
  process.exit(3)
}
const label = databaseLabelPolicy(process.env)
console.log(`Applying pending migrations to the ${operator.target} database (environment intent: ${label.environment}).`)
if (label.warning) console.warn(label.warning)

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env })
process.exit(result.status ?? 1)
