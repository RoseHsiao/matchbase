/**
 * Which deployment this process is, from explicit configuration only.
 *
 * Vercel sets `VERCEL_ENV` to `production`, `preview` or `development` at
 * build and run time (verified against the system environment variables
 * reference, 2026-09-17). Outside Vercel, `NODE_ENV=production` is taken as
 * production and anything else as development. Nothing here inspects
 * connection strings or tries to guess which database is which: the
 * operator states the intent and the code honours it.
 */

export type RuntimeEnvironment = "production" | "preview" | "development"

export type EnvLike = Readonly<Record<string, string | undefined>>

export function resolveRuntimeEnvironment(env: EnvLike): RuntimeEnvironment {
  const vercel = env.VERCEL_ENV?.trim().toLowerCase()
  if (vercel === "production" || vercel === "preview" || vercel === "development") return vercel
  return env.NODE_ENV === "production" ? "production" : "development"
}

/** Truthy spellings an operator might use for an opt-in flag. */
export function isFlagEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "")
}

export type ProviderSyncPolicy = { allowed: true } | { allowed: false; reason: string }

/**
 * Preview deployments must not run provider syncs unless the operator opts
 * in with `ALLOW_PREVIEW_PROVIDER_SYNC=true` (for a preview that is known
 * to point at its own Neon branch). Production and local development are
 * unaffected; the cron secret and admin authorization still apply on top.
 */
export function providerSyncPolicy(env: EnvLike): ProviderSyncPolicy {
  if (resolveRuntimeEnvironment(env) !== "preview") return { allowed: true }
  if (isFlagEnabled(env.ALLOW_PREVIEW_PROVIDER_SYNC)) return { allowed: true }
  return {
    allowed: false,
    reason: "Provider sync is disabled on Preview deployments. Set ALLOW_PREVIEW_PROVIDER_SYNC=true on a preview that uses its own database branch.",
  }
}
