import "server-only"

import { blockingChecks, evaluateProductionReadiness } from "@/lib/env/production-config"
import type { EnvLike } from "@/lib/env/runtime-environment"

/**
 * Startup guard, called once per server instance from instrumentation.ts.
 * In Production every failing check stops the server (a clear crash beats a
 * quietly insecure deployment); in Preview only the checks that could reach
 * Production data or credentials do. Everything else is logged. Details
 * name variables, never values.
 */
export function assertRuntimeConfiguration(env: EnvLike = process.env): void {
  const report = evaluateProductionReadiness(env)
  for (const check of report.checks) {
    if (check.status === "fail") console.error(`[config] FAIL ${check.id}: ${check.detail}`)
    else if (check.status === "warn") console.warn(`[config] warn ${check.id}: ${check.detail}`)
  }
  const blocking = blockingChecks(report)
  if (blocking.length > 0) {
    throw new Error(`MatchBase refuses to start in ${report.environment}: ${blocking.map((check) => check.id).join(", ")}. See the [config] lines above.`)
  }
}
