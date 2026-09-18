/**
 * Runs once when a Next.js server instance starts (not during `next build`,
 * which is guarded explicitly): validates the security-critical
 * configuration before the first request is served.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.NEXT_PHASE === "phase-production-build") return
  const { assertRuntimeConfiguration } = await import("./lib/env/runtime-guard")
  assertRuntimeConfiguration(process.env)
}
