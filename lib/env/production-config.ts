import { MIN_AUTH_SECRET_LENGTH, resolveAuthBaseUrl, signUpPolicy } from "@/lib/auth/auth-env"
import { DEV_LOGIN_FLAG } from "@/lib/auth/dev-login"
import { readScheduleConfig } from "@/lib/data/sync/schedule-config"
import { describeDataSourceProvider } from "@/lib/data/sync/providers/registry"
import { CSP_MODE_VARIABLE, resolveCspMode } from "@/lib/http/csp"
import { databaseLabelPolicy, isFlagEnabled, resolveRuntimeEnvironment, resolveRuntimePlatform, type EnvLike, type RuntimeEnvironment } from "@/lib/env/runtime-environment"

/**
 * Configuration readiness, evaluated from environment variables only: no
 * database, no network, no secret ever copied into a message. The same
 * evaluation backs the operator command `npm run production:check` and the
 * server startup guard (instrumentation.ts), which refuses to serve
 * Production with a failing check.
 *
 * Severity: `fail` blocks Production; `warn` is advice; `info` states a
 * fact. A check marked `previewCritical` also blocks a Preview deployment,
 * because it means the preview could reach Production data or credentials.
 */

export type CheckStatus = "pass" | "warn" | "fail" | "info"

export type ReadinessCheck = {
  id: string
  status: CheckStatus
  /** Never contains a secret value or a connection string. */
  detail: string
  previewCritical?: boolean
}

export type ReadinessReport = {
  environment: RuntimeEnvironment
  platform: ReturnType<typeof resolveRuntimePlatform>
  checks: ReadinessCheck[]
  failures: ReadinessCheck[]
  warnings: ReadinessCheck[]
}

export const CRON_SECRET_MIN_LENGTH = 16

/** Scheduled live sources whose provider configuration a Production deployment is expected to have. */
const SCHEDULED_LIVE_SOURCES = ["ds-thesportsdb-epl"] as const
const OPTIONAL_LIVE_SOURCES = ["ds-tennis-sportradar"] as const
const SYNC_MINUTE_VARIABLES = ["SYNC_EXPECTED_INTERVAL_MINUTES", "SYNC_FRESHNESS_GRACE_MINUTES", "SYNC_MIN_INTERVAL_MINUTES", "SYNC_TIME_BUDGET_MINUTES", "SYNC_STALE_LOCK_MINUTES", "SYNC_MANUAL_COOLDOWN_MINUTES"] as const

/** A production-mode server on the operator's own machine (`next start` smoke test) may use plain http on localhost. */
function isLoopback(baseURL: string): boolean {
  try {
    const { hostname } = new URL(baseURL)
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  } catch {
    return false
  }
}

function distinctCharacters(value: string): number {
  return new Set(value).size
}

/** Parses a connection string for its shape only; the result never includes credentials. */
function describeDatabaseUrl(value: string | undefined): { present: boolean; parses: boolean; sslVerifyFull: boolean; pooled: boolean; host: string } {
  if (!value) return { present: false, parses: false, sslVerifyFull: false, pooled: false, host: "" }
  try {
    const url = new URL(value)
    const ssl = url.searchParams.get("sslmode")
    return { present: true, parses: url.protocol.startsWith("postgres"), sslVerifyFull: ssl === "verify-full", pooled: /-pooler\./.test(url.hostname), host: url.hostname }
  } catch {
    return { present: true, parses: false, sslVerifyFull: false, pooled: false, host: "" }
  }
}

export function evaluateProductionReadiness(env: EnvLike): ReadinessReport {
  const environment = resolveRuntimeEnvironment(env)
  const platform = resolveRuntimePlatform(env)
  const production = environment === "production"
  const checks: ReadinessCheck[] = []
  const add = (check: ReadinessCheck) => checks.push(check)

  add({ id: "environment", status: "info", detail: `Environment intent: ${environment} (${platform}${env.VERCEL_ENV ? `, VERCEL_ENV=${env.VERCEL_ENV}` : ""}).` })

  // Database label and URLs
  const label = databaseLabelPolicy(env)
  if (label.mismatch) add({ id: "database-label", status: "fail", detail: label.mismatch, previewCritical: true })
  else if (label.warning) add({ id: "database-label", status: "warn", detail: label.warning })
  else add({ id: "database-label", status: "pass", detail: `Database label "${label.label}" matches the ${environment} environment.` })

  const runtimeDb = describeDatabaseUrl(env.DATABASE_URL)
  const cliDb = describeDatabaseUrl(env.DATABASE_URL_UNPOOLED)
  if (!runtimeDb.present) add({ id: "database-url", status: "fail", detail: "DATABASE_URL is not set." })
  else if (!runtimeDb.parses) add({ id: "database-url", status: "fail", detail: "DATABASE_URL is not a PostgreSQL connection string." })
  else if (!runtimeDb.sslVerifyFull) add({ id: "database-url", status: production ? "fail" : "warn", detail: "DATABASE_URL must use sslmode=verify-full." })
  else add({ id: "database-url", status: "pass", detail: `DATABASE_URL is set with sslmode=verify-full${runtimeDb.pooled ? " (pooled host)" : " (not a Neon pooler host; fine outside Neon)"}.` })
  if (!cliDb.present) add({ id: "database-url-unpooled", status: production && platform === "vercel" ? "info" : "warn", detail: "DATABASE_URL_UNPOOLED is not set; migrations and operator commands need the direct connection (on Vercel it is only needed where those commands run)." })
  else if (!cliDb.sslVerifyFull) add({ id: "database-url-unpooled", status: production ? "fail" : "warn", detail: "DATABASE_URL_UNPOOLED must use sslmode=verify-full." })
  else add({ id: "database-url-unpooled", status: "pass", detail: "DATABASE_URL_UNPOOLED is set with sslmode=verify-full." })
  if (runtimeDb.present && cliDb.present && env.DATABASE_URL === env.DATABASE_URL_UNPOOLED) {
    add({ id: "database-roles", status: "warn", detail: "DATABASE_URL and DATABASE_URL_UNPOOLED are identical: the runtime uses the migration credential. See docs/security/production-hardening.md for the least-privilege runtime role." })
  } else if (runtimeDb.present && cliDb.present) {
    add({ id: "database-roles", status: "info", detail: "Runtime and migration connection strings differ; run `production:check --db` to confirm the runtime role cannot alter the schema." })
  }

  // Auth
  const secret = env.BETTER_AUTH_SECRET?.trim() ?? ""
  if (secret.length < MIN_AUTH_SECRET_LENGTH) add({ id: "auth-secret", status: "fail", detail: `BETTER_AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} random characters.` })
  else if (distinctCharacters(secret) < 12) add({ id: "auth-secret", status: "fail", detail: "BETTER_AUTH_SECRET looks low-entropy (too few distinct characters); generate it with `openssl rand -base64 32`." })
  else add({ id: "auth-secret", status: "pass", detail: "BETTER_AUTH_SECRET is set and long enough." })
  const baseURL = resolveAuthBaseUrl(env)
  if (environment === "development") add({ id: "auth-url", status: "info", detail: baseURL ? "BETTER_AUTH_URL is set." : "BETTER_AUTH_URL unset; inferred from the request in development." })
  else if (!baseURL) add({ id: "auth-url", status: "fail", detail: "No auth base URL: set BETTER_AUTH_URL or deploy on Vercel where it derives from the system URLs." })
  else if (production && !baseURL.startsWith("https://") && !isLoopback(baseURL)) add({ id: "auth-url", status: "fail", detail: "The Production auth base URL must be https." })
  else add({ id: "auth-url", status: "pass", detail: `Auth base URL resolves (${new URL(baseURL).hostname}).` })

  const cron = env.CRON_SECRET?.trim() ?? ""
  if (production) {
    if (cron.length < CRON_SECRET_MIN_LENGTH) add({ id: "cron-secret", status: "fail", detail: `CRON_SECRET must be at least ${CRON_SECRET_MIN_LENGTH} random characters in Production (scheduled sync refuses to run without it).` })
    else add({ id: "cron-secret", status: "pass", detail: "CRON_SECRET is set." })
  } else if (environment === "preview") {
    add({ id: "cron-secret", status: cron ? "warn" : "pass", detail: cron ? "CRON_SECRET is set on Preview; cron never runs there, so leaving it unset makes the route refuse (503)." : "CRON_SECRET unset on Preview: the cron route answers 503, as intended." })
  } else add({ id: "cron-secret", status: "info", detail: cron ? "CRON_SECRET is set for local smoke tests." : "CRON_SECRET unset (local)." })
  if (secret && cron && secret === cron) add({ id: "secret-separation", status: "fail", detail: "BETTER_AUTH_SECRET and CRON_SECRET must be different values.", previewCritical: true })
  else if (secret && cron) add({ id: "secret-separation", status: "pass", detail: "Auth and cron secrets are distinct." })

  // Launch policy and development-only features
  const signUp = signUpPolicy(env)
  if (production) add({ id: "sign-up", status: signUp.open ? "warn" : "pass", detail: signUp.open ? "Public sign-up is OPEN in Production (AUTH_ALLOW_SIGN_UP=true). Without a mail transport, new accounts cannot verify or recover; see the launch policy." : "Public sign-up is closed (launch policy)." })
  else add({ id: "sign-up", status: "info", detail: `Public sign-up is ${signUp.open ? "open" : "closed"} in ${environment}.` })
  const devLoginFlag = isFlagEnabled(env[DEV_LOGIN_FLAG])
  if (environment !== "development" && devLoginFlag) add({ id: "dev-login", status: "fail", detail: `${DEV_LOGIN_FLAG} is set outside development; the feature refuses to activate, but the flag must not be present on a deployment.`, previewCritical: true })
  else if (environment !== "development" && (env.MATCHBASE_DEV_USER_PASSWORD || env.MATCHBASE_DEV_ADMIN_PASSWORD)) add({ id: "dev-login", status: "fail", detail: "Development account credentials are present on a deployment; remove the MATCHBASE_DEV_* variables.", previewCritical: true })
  else add({ id: "dev-login", status: "pass", detail: environment === "development" ? `Dev quick sign-in ${devLoginFlag ? "enabled" : "disabled"} (development only).` : "Dev quick sign-in is not configured." })
  if (environment !== "development" && isFlagEnabled(env.ALLOW_PRODUCTION_SEED)) add({ id: "seed", status: "fail", detail: "ALLOW_PRODUCTION_SEED is set on a deployment; remove it. The seed is an operator command.", previewCritical: true })
  else add({ id: "seed", status: "pass", detail: "Demo seed is refused for Production (no ALLOW_PRODUCTION_SEED)." })
  if (production && isFlagEnabled(env.ALLOW_PREVIEW_PROVIDER_SYNC)) add({ id: "preview-sync", status: "warn", detail: "ALLOW_PREVIEW_PROVIDER_SYNC is set in Production; it has no effect there and belongs to Preview only." })
  else if (environment === "preview") add({ id: "preview-sync", status: isFlagEnabled(env.ALLOW_PREVIEW_PROVIDER_SYNC) ? "warn" : "pass", detail: isFlagEnabled(env.ALLOW_PREVIEW_PROVIDER_SYNC) ? "Provider sync is enabled on this Preview; confirm it uses its own database branch." : "Provider sync is disabled on Preview (default)." })

  // Headers and CSP
  const cspRaw = env[CSP_MODE_VARIABLE]?.trim()
  const csp = resolveCspMode(env)
  if (cspRaw && !["enforce", "report-only", "off"].includes(cspRaw.toLowerCase())) add({ id: "csp", status: "fail", detail: `${CSP_MODE_VARIABLE} must be enforce, report-only or off.` })
  else if (csp === "off") add({ id: "csp", status: production ? "fail" : "warn", detail: "Content Security Policy is off." })
  else add({ id: "csp", status: csp === "enforce" ? "pass" : "warn", detail: `Content Security Policy mode: ${csp}.` })

  // Providers and sync cadence
  for (const id of SCHEDULED_LIVE_SOURCES) {
    const info = describeDataSourceProvider(id)
    if (!info) add({ id: `provider:${id}`, status: "warn", detail: `${id} has no provider bound.` })
    else if (!info.configuration.configured) add({ id: `provider:${id}`, status: production ? "fail" : "warn", detail: `${info.name} is not configured: ${info.configuration.error ?? "missing configuration"}. Scheduled sync would record failures.` })
    else add({ id: `provider:${id}`, status: "pass", detail: `${info.name} is configured.` })
  }
  for (const id of OPTIONAL_LIVE_SOURCES) {
    const info = describeDataSourceProvider(id)
    if (info && !info.configuration.configured) add({ id: `provider:${id}`, status: "info", detail: `${info.name} is not configured; that source is not schedulable and reports "not configured" in Admin.` })
    else if (info) add({ id: `provider:${id}`, status: "pass", detail: `${info.name} is configured.` })
  }
  // readScheduleConfig silently falls back on a bad value; here a set-but-invalid value is a misconfiguration.
  const invalidCadence = SYNC_MINUTE_VARIABLES.filter((name) => {
    const value = env[name]?.trim()
    return value !== undefined && value !== "" && !(Number.isFinite(Number(value)) && Number(value) > 0)
  })
  if (invalidCadence.length > 0) add({ id: "sync-cadence", status: "fail", detail: `Sync cadence variables must be positive numbers of minutes: ${invalidCadence.join(", ")}.` })
  else {
    const schedule = readScheduleConfig(env)
    add({ id: "sync-cadence", status: "pass", detail: `Expected interval ${Math.round(schedule.expectedIntervalMs / 60_000)} min, grace ${Math.round(schedule.graceMs / 60_000)} min, manual cooldown ${Math.round(schedule.manualCooldownMs / 60_000)} min.` })
  }

  return {
    environment,
    platform,
    checks,
    failures: checks.filter((check) => check.status === "fail"),
    warnings: checks.filter((check) => check.status === "warn"),
  }
}

/** Which checks must stop the server from serving in this environment. */
export function blockingChecks(report: ReadinessReport): ReadinessCheck[] {
  if (report.environment === "production") return report.failures
  if (report.environment === "preview") return report.failures.filter((check) => check.previewCritical)
  return []
}
