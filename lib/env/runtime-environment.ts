/**
 * The single interpretation of "which deployment is this", from explicit
 * configuration only. Every environment-sensitive decision (dev quick
 * sign-in, sign-up policy, provider-sync policy, seed policy, operator
 * confirmation, readiness checks) reads these functions instead of looking
 * at `process.env.VERCEL_ENV` on its own.
 *
 * Environment intent (`resolveRuntimeEnvironment`): Vercel sets `VERCEL_ENV`
 * to `production`, `preview` or `development` at build and run time
 * (system environment variables reference, verified 2026-09-17). Outside
 * Vercel, `NODE_ENV=production` is production (self-hosted or `next start`)
 * and anything else is local development.
 *
 * Database label (`MATCHBASE_DATABASE_LABEL`): a non-secret word the
 * operator sets next to each DATABASE_URL saying which database it is. Code
 * cannot prove that two connection strings point at different databases and
 * never parses them to guess; it can check that the stated label agrees with
 * the environment intent, which is what stops a Preview or a developer shell
 * from silently working against Production.
 */

export type RuntimeEnvironment = "production" | "preview" | "development"

export type EnvLike = Readonly<Record<string, string | undefined>>

export function resolveRuntimeEnvironment(env: EnvLike): RuntimeEnvironment {
  const vercel = env.VERCEL_ENV?.trim().toLowerCase()
  if (vercel === "production" || vercel === "preview" || vercel === "development") return vercel
  return env.NODE_ENV === "production" ? "production" : "development"
}

export type RuntimePlatform = "vercel" | "self-hosted" | "local"

/** Where the process runs; informational, never a security decision on its own. */
export function resolveRuntimePlatform(env: EnvLike): RuntimePlatform {
  if (env.VERCEL === "1" || env.VERCEL_ENV) return "vercel"
  return env.NODE_ENV === "production" ? "self-hosted" : "local"
}

/** Truthy spellings an operator might use for an opt-in flag. */
export function isFlagEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "")
}

// ---------------------------------------------------------------------------
// Database label
// ---------------------------------------------------------------------------

export const DATABASE_LABEL_VARIABLE = "MATCHBASE_DATABASE_LABEL"
export const DATABASE_LABELS = ["development", "preview", "production"] as const
export type DatabaseLabel = (typeof DATABASE_LABELS)[number]

export function readDatabaseLabel(env: EnvLike): DatabaseLabel | undefined {
  const value = env[DATABASE_LABEL_VARIABLE]?.trim().toLowerCase()
  return (DATABASE_LABELS as readonly string[]).includes(value ?? "") ? (value as DatabaseLabel) : undefined
}

export type DatabaseLabelVerdict = {
  environment: RuntimeEnvironment
  label: DatabaseLabel | undefined
  /** A mismatch that must stop a deployment or an operator command. */
  mismatch: string | null
  /** Advice that does not stop anything. */
  warning: string | null
}

/**
 * Production must run against a database labelled `production`; nothing
 * else may. A missing label is a warning outside production (local
 * checkouts rarely set it) and a mismatch in production, where every
 * variable is deliberate.
 */
export function databaseLabelPolicy(env: EnvLike): DatabaseLabelVerdict {
  const environment = resolveRuntimeEnvironment(env)
  const label = readDatabaseLabel(env)
  const raw = env[DATABASE_LABEL_VARIABLE]?.trim()
  if (raw && !label) {
    return { environment, label, mismatch: `${DATABASE_LABEL_VARIABLE} must be one of ${DATABASE_LABELS.join(", ")}.`, warning: null }
  }
  if (environment === "production") {
    if (label !== "production") return { environment, label, mismatch: `Production requires ${DATABASE_LABEL_VARIABLE}=production next to the Production DATABASE_URL (it is ${label ?? "unset"}).`, warning: null }
    return { environment, label, mismatch: null, warning: null }
  }
  if (label === "production") {
    return { environment, label, mismatch: `${DATABASE_LABEL_VARIABLE} says this is the Production database, but the environment is ${environment}.`, warning: null }
  }
  if (!label) return { environment, label, mismatch: null, warning: `${DATABASE_LABEL_VARIABLE} is unset; set it to ${environment} so operator commands can tell databases apart.` }
  return { environment, label, mismatch: null, warning: null }
}

// ---------------------------------------------------------------------------
// Dangerous operations
// ---------------------------------------------------------------------------

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

export const OPERATOR_TARGET_VARIABLE = "MATCHBASE_OPERATOR_TARGET"

export type OperatorPolicy = { allowed: true; target: DatabaseLabel | "unlabelled" } | { allowed: false; reason: string }

/**
 * Operator commands (migrations, role grants, password resets, manual sync)
 * may touch the Production database, but only when the shell says so twice:
 * the database is labelled `production` and `MATCHBASE_OPERATOR_TARGET=production`
 * is set for that invocation. Any other database needs no confirmation, so
 * local work and CI stay scriptable.
 */
export function operatorPolicy(env: EnvLike): OperatorPolicy {
  const label = readDatabaseLabel(env)
  const raw = env[DATABASE_LABEL_VARIABLE]?.trim()
  if (raw && !label) return { allowed: false, reason: `${DATABASE_LABEL_VARIABLE} must be one of ${DATABASE_LABELS.join(", ")}.` }
  if (label === "production" && env[OPERATOR_TARGET_VARIABLE]?.trim().toLowerCase() !== "production") {
    return { allowed: false, reason: `This shell targets the Production database (${DATABASE_LABEL_VARIABLE}=production). Set ${OPERATOR_TARGET_VARIABLE}=production for this command to confirm.` }
  }
  return { allowed: true, target: label ?? "unlabelled" }
}

export type SeedPolicy = { allowed: true; note: string | null } | { allowed: false; reason: string }

/**
 * The demo seed writes the demo user, demo matches and mock provider rows.
 * It is refused for Production intent or a Production-labelled database
 * unless the operator sets `ALLOW_PRODUCTION_SEED=true` together with the
 * operator confirmation. Preview is allowed but noted as deliberate.
 */
export function seedPolicy(env: EnvLike): SeedPolicy {
  const environment = resolveRuntimeEnvironment(env)
  const label = readDatabaseLabel(env)
  const operator = operatorPolicy(env)
  if (!operator.allowed) return { allowed: false, reason: operator.reason }
  if (environment === "production" || label === "production") {
    if (!isFlagEnabled(env.ALLOW_PRODUCTION_SEED)) {
      return { allowed: false, reason: "The demo seed is refused for Production (environment or database label). Set ALLOW_PRODUCTION_SEED=true and MATCHBASE_OPERATOR_TARGET=production only if demo data in Production is really intended." }
    }
    return { allowed: true, note: "Seeding a Production database because ALLOW_PRODUCTION_SEED=true." }
  }
  if (environment === "preview") return { allowed: true, note: "Seeding a Preview database; make sure it is a Preview branch, not Production." }
  return { allowed: true, note: null }
}
