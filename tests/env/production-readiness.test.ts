import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { blockingChecks, evaluateProductionReadiness } from "../../lib/env/production-config"

/**
 * The readiness evaluation that backs `npm run production:check` and the
 * startup guard. Every detail line is checked to contain no secret value.
 */

const SECRET = "Qm9a7x3fKp2LwZ8vN4cR1tY6uH0sJ5eD9gB3nM7kV1a="
const CRON = "cron-9f8e7d6c5b4a3f2e1d0c"
const DB = "postgresql://matchbase_app:runtime-pass-word@ep-abc-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full"
const DB_DIRECT = "postgresql://neondb_owner:owner-pass-word@ep-abc.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full"

const production = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_PRODUCTION_URL: "matchbase.example",
  MATCHBASE_DATABASE_LABEL: "production",
  DATABASE_URL: DB,
  DATABASE_URL_UNPOOLED: DB_DIRECT,
  BETTER_AUTH_SECRET: SECRET,
  CRON_SECRET: CRON,
}

function ids(checks: { id: string }[]): string[] {
  return checks.map((check) => check.id).sort()
}

describe("evaluateProductionReadiness", () => {
  it("a complete Production configuration is ready", () => {
    const report = evaluateProductionReadiness(production)
    assert.deepEqual(ids(report.failures), [])
    assert.equal(report.environment, "production")
    assert.equal(report.platform, "vercel")
    assert.equal(report.checks.find((c) => c.id === "sign-up")?.status, "pass")
    assert.equal(report.checks.find((c) => c.id === "csp")?.status, "pass")
    assert.equal(report.checks.find((c) => c.id === "provider:ds-thesportsdb-epl")?.status, "pass", "the public free key configures TheSportsDB")
  })

  it("never prints a secret or a connection string", () => {
    const report = evaluateProductionReadiness(production)
    const text = JSON.stringify(report)
    for (const value of [SECRET, CRON, "runtime-pass-word", "owner-pass-word", "postgresql://"]) assert.equal(text.includes(value), false, value)
  })

  it("fails Production on each missing or weak security-critical value", () => {
    const cases: [Partial<Record<string, string | undefined>>, string][] = [
      [{ MATCHBASE_DATABASE_LABEL: undefined }, "database-label"],
      [{ MATCHBASE_DATABASE_LABEL: "preview" }, "database-label"],
      [{ DATABASE_URL: undefined }, "database-url"],
      [{ DATABASE_URL: DB.replace("verify-full", "require") }, "database-url"],
      [{ BETTER_AUTH_SECRET: "short" }, "auth-secret"],
      [{ BETTER_AUTH_SECRET: "a".repeat(40) }, "auth-secret"],
      [{ VERCEL_PROJECT_PRODUCTION_URL: undefined }, "auth-url"],
      [{ BETTER_AUTH_URL: "http://matchbase.example" }, "auth-url"],
      [{ BETTER_AUTH_URL: "https://[SENSITIVE]" }, "auth-url"],
      [{ CRON_SECRET: undefined }, "cron-secret"],
      [{ CRON_SECRET: "short" }, "cron-secret"],
      [{ CRON_SECRET: SECRET }, "secret-separation"],
      [{ MATCHBASE_DEV_LOGIN: "true" }, "dev-login"],
      [{ MATCHBASE_DEV_ADMIN_PASSWORD: "dev-admin-password-1" }, "dev-login"],
      [{ ALLOW_PRODUCTION_SEED: "true" }, "seed"],
      [{ CSP_MODE: "off" }, "csp"],
      [{ CSP_MODE: "sometimes" }, "csp"],
      [{ SYNC_EXPECTED_INTERVAL_MINUTES: "abc" }, "sync-cadence"],
    ]
    for (const [override, expected] of cases) {
      const report = evaluateProductionReadiness({ ...production, ...override })
      assert.ok(report.failures.some((check) => check.id === expected), `${JSON.stringify(override)} should fail ${expected}; failures: ${ids(report.failures).join(",")}`)
      assert.ok(blockingChecks(report).some((check) => check.id === expected), `${expected} blocks Production`)
    }
  })

  it("warns, rather than fails, on open sign-up with verification mail, identical database roles and report-only CSP", () => {
    const mail = { MAIL_TRANSPORT: "resend", MAIL_FROM: "noreply@mail.matchbase.example", RESEND_API_KEY: "re_TestKey_0123456789abcdef", AUTH_EMAIL_VERIFICATION_ENABLED: "true" }
    const report = evaluateProductionReadiness({ ...production, ...mail, AUTH_ALLOW_SIGN_UP: "true", DATABASE_URL_UNPOOLED: DB, CSP_MODE: "report-only" })
    assert.deepEqual(ids(report.failures), [])
    assert.deepEqual(ids(report.warnings), ["csp", "database-roles", "sign-up"])
    assert.match(report.warnings.find((c) => c.id === "sign-up")?.detail ?? "", /OPEN.*required email verification.*release procedure/)
  })

  it("Phase 10.7: open sign-up without verification mail is refused and fails Production, with or without a transport", () => {
    const resend = { MAIL_TRANSPORT: "resend", MAIL_FROM: "noreply@mail.matchbase.example", RESEND_API_KEY: "re_TestKey_0123456789abcdef" }
    for (const extra of [{}, resend]) {
      const report = evaluateProductionReadiness({ ...production, ...extra, AUTH_ALLOW_SIGN_UP: "true" })
      assert.ok(ids(report.failures).includes("sign-up"), JSON.stringify(extra))
      assert.match(report.failures.find((c) => c.id === "sign-up")?.detail ?? "", /verification mail is not available.*sign-up stays closed/)
    }
  })

  it("Preview blocks only what could reach Production", () => {
    const preview = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "matchbase-git-x.vercel.app", MATCHBASE_DATABASE_LABEL: "preview", DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB_DIRECT, BETTER_AUTH_SECRET: SECRET }
    const clean = evaluateProductionReadiness(preview)
    assert.deepEqual(blockingChecks(clean), [])
    assert.equal(clean.checks.find((c) => c.id === "cron-secret")?.status, "pass", "no cron secret on preview is the intended state")
    assert.equal(clean.checks.find((c) => c.id === "preview-sync")?.status, "pass")
    const dangerous = evaluateProductionReadiness({ ...preview, MATCHBASE_DATABASE_LABEL: "production", MATCHBASE_DEV_LOGIN: "true", CRON_SECRET: CRON })
    assert.deepEqual(ids(blockingChecks(dangerous)), ["database-label", "dev-login"])
    assert.equal(dangerous.checks.find((c) => c.id === "cron-secret")?.status, "warn")
    // A weak auth secret is a failure the report shows, but Preview does not refuse to start for it.
    const weak = evaluateProductionReadiness({ ...preview, BETTER_AUTH_SECRET: "short" })
    assert.ok(weak.failures.some((c) => c.id === "auth-secret"))
    assert.deepEqual(blockingChecks(weak), [])
  })

  it("development never blocks and reports the dev-only features as information", () => {
    const report = evaluateProductionReadiness({ DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB_DIRECT, BETTER_AUTH_SECRET: SECRET, MATCHBASE_DEV_LOGIN: "true", MATCHBASE_DATABASE_LABEL: "development" })
    assert.deepEqual(blockingChecks(report), [])
    assert.equal(report.checks.find((c) => c.id === "dev-login")?.status, "pass")
    assert.equal(report.checks.find((c) => c.id === "sign-up")?.status, "info")
  })
})

describe("mail and password-recovery readiness", () => {
  const KEY = "re_TestKey_0123456789abcdef"
  const resend = { MAIL_TRANSPORT: "resend", MAIL_FROM: "MatchBase <noreply@mail.matchbase.example>", RESEND_API_KEY: KEY }
  const status = (env: Record<string, string>, id: string) => evaluateProductionReadiness(env).checks.find((check) => check.id === id)?.status
  const failing = (env: Record<string, string>) => ids(evaluateProductionReadiness(env).failures)

  it("today's Production (no mail variables) is ready: mail disabled, recovery disabled", () => {
    assert.deepEqual(failing(production), [])
    assert.equal(status(production, "mail-transport"), "pass")
    assert.equal(status(production, "password-recovery"), "pass")
    assert.match(evaluateProductionReadiness(production).checks.find((c) => c.id === "password-recovery")?.detail ?? "", /disabled.*account:password/)
  })

  it("Production with Resend from an own domain and recovery on is ready, and says what it did not check", () => {
    const env = { ...production, ...resend, AUTH_PASSWORD_RESET_ENABLED: "true" }
    assert.deepEqual(failing(env), [])
    assert.equal(status(env, "password-recovery"), "pass")
    const domain = evaluateProductionReadiness(env).checks.find((c) => c.id === "mail-domain")
    assert.equal(domain?.status, "info", "DNS verification is never claimed")
    assert.match(domain?.detail ?? "", /Not checked here.*mail\.matchbase\.example.*Resend dashboard/)
  })

  it("Production fails on every unsafe mail combination", () => {
    const cases: [Record<string, string>, string][] = [
      [{ MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com" }, "mail:MAIL_TRANSPORT"],
      [{ MAIL_TRANSPORT: "capture", MAIL_FROM: "dev@example.com" }, "mail:MAIL_TRANSPORT"],
      [{ ...resend, MAIL_FROM: "onboarding@resend.dev" }, "mail:MAIL_FROM"],
      [{ ...resend, MAIL_ALLOWED_RECIPIENTS: "me@example.com" }, "mail:MAIL_ALLOWED_RECIPIENTS"],
      [{ ...resend, RESEND_API_KEY: "" }, "mail:RESEND_API_KEY"],
      [{ ...resend, MAIL_FROM: "Evil\nBcc: x@example.com <a@example.com>" }, "mail:MAIL_FROM"],
      [{ AUTH_PASSWORD_RESET_ENABLED: "true" }, "password-recovery"],
      [{ MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com", AUTH_PASSWORD_RESET_ENABLED: "true" }, "password-recovery"],
      [{ ...resend, RESEND_API_KEY: SECRET.replace(/[^A-Za-z0-9]/g, "").replace(/^/, "re_"), BETTER_AUTH_SECRET: SECRET.replace(/[^A-Za-z0-9]/g, "").replace(/^/, "re_") }, "mail-secret-separation"],
    ]
    for (const [extra, expected] of cases) {
      const env = { ...production, ...extra }
      assert.ok(failing(env).includes(expected), `${JSON.stringify(extra)} → ${failing(env).join(", ")}`)
      assert.ok(blockingChecks(evaluateProductionReadiness(env)).some((c) => c.id === expected), "blocks Production startup")
    }
  })

  it("Preview: Resend needs an exact allowlist; a refusal warns without blocking, a shared key blocks", () => {
    const preview = { ...production, VERCEL_ENV: "preview", MATCHBASE_DATABASE_LABEL: "preview", VERCEL_URL: "matchbase-git-x.vercel.app", CRON_SECRET: "" }
    const noList = evaluateProductionReadiness({ ...preview, ...resend })
    assert.equal(noList.checks.find((c) => c.id === "mail:MAIL_ALLOWED_RECIPIENTS")?.status, "warn")
    assert.equal(noList.checks.find((c) => c.id === "mail-transport")?.status, "warn", "falls back to disabled")
    assert.deepEqual(blockingChecks(noList).filter((c) => c.id.startsWith("mail")), [])
    const listed = evaluateProductionReadiness({ ...preview, ...resend, MAIL_ALLOWED_RECIPIENTS: "tester@example.com, second@example.com" })
    assert.match(listed.checks.find((c) => c.id === "mail-transport")?.detail ?? "", /only to 2 allowlisted addresses/)
    assert.ok(!JSON.stringify(listed).includes("tester@example.com"), "allowlisted addresses are never printed")
    const shared = evaluateProductionReadiness({ ...preview, ...resend, MAIL_ALLOWED_RECIPIENTS: "tester@example.com", CRON_SECRET: KEY })
    assert.ok(blockingChecks(shared).some((c) => c.id === "mail-secret-separation"))
    const outbox = evaluateProductionReadiness({ ...preview, MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com" })
    assert.equal(outbox.checks.find((c) => c.id === "mail:MAIL_TRANSPORT")?.status, "warn")
  })

  it("verification mail is its own reported switch: off passes, on with Resend passes, requested without a transport fails", () => {
    assert.equal(status(production, "email-verification"), "pass")
    assert.match(evaluateProductionReadiness({ ...production, ...resend }).checks.find((c) => c.id === "email-verification")?.detail ?? "", /disabled.*public sign-up cannot open/)
    assert.equal(status({ ...production, ...resend, AUTH_EMAIL_VERIFICATION_ENABLED: "true" }, "email-verification"), "pass")
    const broken = { ...production, AUTH_EMAIL_VERIFICATION_ENABLED: "true" }
    assert.equal(status(broken, "email-verification"), "fail")
    assert.ok(blockingChecks(evaluateProductionReadiness(broken)).some((c) => c.id === "email-verification"))
    assert.equal(evaluateProductionReadiness(broken).checks.filter((c) => c.id === "mail:AUTH_EMAIL_VERIFICATION_ENABLED").length, 0, "reported once")
  })

  it("development: the outbox is information, never a failure", () => {
    const report = evaluateProductionReadiness({ NODE_ENV: "development", MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com", AUTH_PASSWORD_RESET_ENABLED: "true" })
    assert.equal(report.checks.find((c) => c.id === "mail-transport")?.status, "info")
    assert.equal(report.checks.find((c) => c.id === "password-recovery")?.status, "pass")
    assert.deepEqual(blockingChecks(report), [])
  })

  it("never prints the Resend key", () => {
    for (const env of [{ ...production, ...resend }, { ...production, ...resend, MAIL_FROM: "bad" }, { ...production, ...resend, RESEND_API_KEY: "re_short" }]) {
      const text = JSON.stringify(evaluateProductionReadiness(env))
      assert.ok(!text.includes(KEY) && !text.includes("re_short"))
    }
  })
})
