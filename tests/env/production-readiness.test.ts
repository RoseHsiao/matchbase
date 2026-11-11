import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { blockingChecks, evaluateProductionReadiness } from "../../lib/env/production-config"

/**
 * The readiness evaluation that backs `npm run production:check` and the
 * startup guard. Every detail line is checked to contain no secret value.
 */

const SECRET = "Qm9a7x3fKp2LwZ8vN4cR1tY6uH0sJ5eD9gB3nM7kV1a="
const CRON = "cron-9f8e7d6c5b4a3f2e1d0c"
const DB = "postgresql://matchbase_app:runtime-pass-word@ep-test-fixture-a1b2c3d4-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full"
/** The Prisma 7.10 migration-engine form (synthetic, nonfunctional credentials and host). */
const DB_DIRECT = "postgresql://neondb_owner:owner-pass-word@ep-test-fixture-a1b2c3d4.eu-central-1.aws.neon.tech/neondb?sslmode=require&sslaccept=strict&channel_binding=require"

const production = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_PRODUCTION_URL: "matchbase.example",
  MATCHBASE_DATABASE_LABEL: "production",
  MATCHBASE_DATABASE_ENDPOINT: "ep-test-fixture-a1b2c3d4",
  DATABASE_URL: DB,
  DATABASE_URL_UNPOOLED: DB_DIRECT,
  BETTER_AUTH_SECRET: SECRET,
  CRON_SECRET: CRON,
}

/** The operator shell: `production:check --env production` sets VERCEL_ENV but not VERCEL. */
const operator = { ...production, VERCEL: undefined }

function ids(checks: { id: string }[]): string[] {
  return checks.map((check) => check.id).sort()
}

describe("runtime DATABASE_URL TLS policy (node-postgres)", () => {
  const runtime = (value: string | undefined, env: Record<string, string | undefined> = operator) =>
    evaluateProductionReadiness({ ...env, DATABASE_URL: value }).checks.find((check) => check.id === "database-url")

  it("accepts sslmode=verify-full, alone or with channel_binding=require, and says pg does not enforce channel binding", () => {
    assert.equal(runtime(DB)?.status, "pass")
    const withBinding = runtime(`${DB}&channel_binding=require`)
    assert.equal(withBinding?.status, "pass")
    assert.match(withBinding?.detail ?? "", /not enforced by the runtime pg driver/)
  })

  it("rejects sslmode=require, which pg would not verify like verify-full is meant to, and the failure blocks Production even when deployed", () => {
    for (const env of [operator, production]) {
      const value = DB.replace("verify-full", "require")
      assert.equal(runtime(value, env)?.status, "fail")
      assert.ok(blockingChecks(evaluateProductionReadiness({ ...env, DATABASE_URL: value })).some((check) => check.id === "database-url"))
    }
  })

  it("rejects a missing, duplicated or conflicting sslmode", () => {
    const bare = DB.replace("?sslmode=verify-full", "")
    for (const value of [bare, `${DB}&sslmode=verify-full`, `${DB}&sslmode=require`, `${bare}?channel_binding=require`]) {
      assert.equal(runtime(value)?.status, "fail", value)
    }
  })

  it("a duplicated or conflicting sslmode blocks startup in a running deployment too, not only in the operator shell", () => {
    for (const value of [`${DB}&sslmode=verify-full`, `${DB}&sslmode=require`, `${DB}&sslmode=disable`]) {
      for (const env of [production, operator]) {
        const report = evaluateProductionReadiness({ ...env, DATABASE_URL: value })
        assert.equal(report.checks.find((c) => c.id === "database-url")?.status, "fail", value)
        assert.ok(blockingChecks(report).some((c) => c.id === "database-url"), `${value} blocks (${env.VERCEL ? "deployed" : "operator"})`)
      }
    }
  })

  it("does not accept the migration policy in its place", () => {
    assert.equal(runtime(DB.replace("sslmode=verify-full", "sslmode=require&sslaccept=strict&channel_binding=require"))?.status, "fail")
  })

  it("rejects unexpected parameters in the operator shell, and only warns about them in a running deployment", () => {
    for (const extra of ["&options=-c%20role%3Dother", "&sslrootcert=/tmp/ca.pem", "&channel_binding=prefer", "&channel_binding=require&channel_binding=require"]) {
      assert.equal(runtime(`${DB}${extra}`)?.status, "fail", extra)
      assert.equal(runtime(`${DB}${extra}`, production)?.status, "warn", extra)
    }
  })
})

describe("migration DATABASE_URL_UNPOOLED TLS policy (Prisma 7.10 migration engine)", () => {
  const migration = (value: string | undefined, env: Record<string, string | undefined> = operator) =>
    evaluateProductionReadiness({ ...env, DATABASE_URL_UNPOOLED: value }).checks.find((check) => check.id === "database-url-unpooled")
  const base = DB_DIRECT.slice(0, DB_DIRECT.indexOf("?"))

  it("accepts exactly sslmode=require, sslaccept=strict and channel_binding=require on a direct host, in any order", () => {
    assert.equal(migration(DB_DIRECT)?.status, "pass")
    assert.equal(migration(`${base}?channel_binding=require&sslaccept=strict&sslmode=require`)?.status, "pass")
  })

  it("rejects every deviation, and the failure blocks the operator's Production check", () => {
    const cases: [string, string][] = [
      ["missing sslaccept", `${base}?sslmode=require&channel_binding=require`],
      ["sslaccept=accept_invalid_certs", `${base}?sslmode=require&sslaccept=accept_invalid_certs&channel_binding=require`],
      ["missing channel_binding", `${base}?sslmode=require&sslaccept=strict`],
      ["channel_binding=prefer", `${base}?sslmode=require&sslaccept=strict&channel_binding=prefer`],
      ["missing sslmode", `${base}?sslaccept=strict&channel_binding=require`],
      ["sslmode=verify-full, which the engine ignores", `${base}?sslmode=verify-full&sslaccept=strict&channel_binding=require`],
      ["the old runtime-style URL", `${base}?sslmode=verify-full&channel_binding=require`],
      ["duplicate sslaccept", `${DB_DIRECT}&sslaccept=strict`],
      ["conflicting sslmode", `${DB_DIRECT}&sslmode=verify-full`],
      ["sslrootcert, which the engine silently discards", `${DB_DIRECT}&sslrootcert=/tmp/ca.pem`],
      ["options", `${DB_DIRECT}&options=-c%20role%3Dother`],
      ["an unexpected parameter", `${DB_DIRECT}&connect_timeout=10`],
      ["no parameters", base],
    ]
    for (const [name, value] of cases) {
      assert.equal(migration(value)?.status, "fail", name)
      assert.ok(blockingChecks(evaluateProductionReadiness({ ...operator, DATABASE_URL_UNPOOLED: value })).some((check) => check.id === "database-url-unpooled"), `${name} blocks`)
    }
  })

  it("still rejects a pooler host and a missing or invalid hostname", () => {
    assert.equal(migration(DB_DIRECT.replace("ep-test-fixture-a1b2c3d4.", "ep-test-fixture-a1b2c3d4-pooler."))?.status, "fail")
    assert.match(migration(DB_DIRECT.replace("ep-test-fixture-a1b2c3d4.", "ep-test-fixture-a1b2c3d4-pooler."))?.detail ?? "", /pooler/)
    for (const value of ["postgresql://neondb_owner:p@/neondb?sslmode=require&sslaccept=strict&channel_binding=require", "postgresql:///neondb?sslmode=require&sslaccept=strict&channel_binding=require", "not a url", DB_DIRECT.replace("postgresql:", "https:")]) {
      assert.equal(migration(value)?.status, "fail", value)
    }
  })

  it("a running deployment only warns: it never connects with this variable, so it must not refuse to start (Vercel's value is still verify-full)", () => {
    for (const value of [`${base}?sslmode=verify-full`, DB_DIRECT.replace("ep-test-fixture-a1b2c3d4.", "ep-test-fixture-a1b2c3d4-pooler."), "not a url"]) {
      const report = evaluateProductionReadiness({ ...production, DATABASE_URL_UNPOOLED: value })
      const check = report.checks.find((c) => c.id === "database-url-unpooled")
      assert.equal(check?.status, "warn", value)
      assert.match(check?.detail ?? "", /running application does not connect with this variable/)
      assert.match(check?.detail ?? "", /build \(prisma generate loading prisma\.config\.ts\) needs a non-empty value/)
      assert.ok(!blockingChecks(report).some((c) => c.id === "database-url-unpooled"), "not blocking")
    }
  })

  it("never advises removing DATABASE_URL_UNPOOLED and reports the correct status for each runtime context", () => {
    const deployedProblems = [`${base}?sslmode=verify-full`, DB_DIRECT.replace("ep-test-fixture-a1b2c3d4.", "ep-test-fixture-a1b2c3d4-pooler."), "not a url"]
    const cases: [Record<string, string | undefined>, string][] = [
      ...deployedProblems.map((value): [Record<string, string | undefined>, string] => [{ ...production, DATABASE_URL_UNPOOLED: value }, "warn"]),
      // A real Vercel Production deployment (VERCEL=1) without the variable: info.
      [{ ...production, DATABASE_URL_UNPOOLED: undefined }, "info"],
      // The operator shell (`production:check --env production`: VERCEL_ENV=production, no VERCEL=1) needs it: warn.
      [{ ...operator, DATABASE_URL_UNPOOLED: undefined }, "warn"],
      [{ ...operator, DATABASE_URL_UNPOOLED: DB_DIRECT }, "pass"],
      [{ ...production, DATABASE_URL_UNPOOLED: DB_DIRECT }, "pass"],
    ]
    for (const [env, status] of cases) {
      const check = evaluateProductionReadiness(env).checks.find((c) => c.id === "database-url-unpooled")
      assert.equal(check?.status, status, `${env.VERCEL ? "Vercel" : "operator"} with ${env.DATABASE_URL_UNPOOLED === undefined ? "no" : "a"} DATABASE_URL_UNPOOLED`)
      assert.doesNotMatch(check?.detail ?? "", /remov|omit|only needed where|optional on Vercel/i)
    }
    const missing = evaluateProductionReadiness({ ...production, DATABASE_URL_UNPOOLED: undefined }).checks.find((c) => c.id === "database-url-unpooled")
    assert.match(missing?.detail ?? "", /Vercel build needs a non-empty value because prisma generate loads prisma\.config\.ts/)
    assert.match(missing?.detail ?? "", /running application never connects with it/)
  })

  it("never names a credential, host, endpoint or the value it found", () => {
    const report = evaluateProductionReadiness({ ...operator, DATABASE_URL: `${DB}&sslmode=prefer&weird=x`, DATABASE_URL_UNPOOLED: `${base}?sslmode=verify-full&sslaccept=bogus-value&channel_binding=sideways` })
    const text = JSON.stringify(report)
    for (const leak of ["owner-pass-word", "runtime-pass-word", "postgresql://", "ep-test-fixture-a1b2c3d4", "neon.tech", "bogus-value", "sideways"]) assert.equal(text.includes(leak), false, leak)
  })

  it("the policies are separate: the runtime policy is never applied to the migration URL, nor the reverse", () => {
    const report = evaluateProductionReadiness(operator)
    assert.equal(report.checks.find((c) => c.id === "database-url")?.status, "pass")
    assert.equal(report.checks.find((c) => c.id === "database-url-unpooled")?.status, "pass")
  })
})

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
    // Identical strings. The two URLs now need different TLS parameters, so identical strings can only satisfy one
    // policy: here the runtime one. In a running deployment the migration URL then warns (it is unused there).
    // Without MATCHBASE_DATABASE_ENDPOINT (Production only warns until it is set); with it, the pooled
    // DATABASE_URL_UNPOOLED would fail the endpoint check, which "database endpoint" tests below cover.
    const report = evaluateProductionReadiness({ ...production, ...mail, AUTH_ALLOW_SIGN_UP: "true", DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB, CSP_MODE: "report-only", MATCHBASE_DATABASE_ENDPOINT: undefined })
    assert.deepEqual(ids(report.failures), [])
    assert.deepEqual(ids(report.warnings), ["csp", "database-endpoint", "database-roles", "database-url-unpooled", "sign-up"])
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

  describe("dual-flag unverified sign-up (AUTH_ALLOW_SIGN_UP + AUTH_ALLOW_UNVERIFIED_SIGN_UP)", () => {
    const preview = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "matchbase-git-x.vercel.app", MATCHBASE_DATABASE_LABEL: "preview", MATCHBASE_DATABASE_ENDPOINT: "ep-test-fixture-a1b2c3d4", DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB_DIRECT, BETTER_AUTH_SECRET: SECRET }
    const signUp = (env: Record<string, string | undefined>) => evaluateProductionReadiness(env).checks.find((c) => c.id === "sign-up")

    for (const [name, base] of [["Production", production], ["Preview", preview]] as const) {
      it(`${name}: either flag alone fails and the startup guard blocks`, () => {
        for (const half of [{ AUTH_ALLOW_SIGN_UP: "true" }, { AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }, { AUTH_ALLOW_SIGN_UP: "false", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }]) {
          const report = evaluateProductionReadiness({ ...base, ...half })
          assert.equal(signUp({ ...base, ...half })?.status, "fail", JSON.stringify(half))
          assert.ok(blockingChecks(report).some((c) => c.id === "sign-up"), `${name} refuses to start: ${JSON.stringify(half)}`)
        }
      })

      it(`${name}: both flags pass with a WARN that says unverified, no recovery and enumeration`, () => {
        const env = { ...base, AUTH_ALLOW_SIGN_UP: "true", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }
        const check = signUp(env)
        assert.equal(check?.status, "warn")
        assert.match(check?.detail ?? "", /OPEN in (production|preview) WITHOUT email verification/)
        assert.match(check?.detail ?? "", /no self-service password recovery/)
        assert.match(check?.detail ?? "", /reveals whether an address already has an account/)
        assert.match(check?.detail ?? "", /5 per IP per hour/)
        assert.ok(!blockingChecks(evaluateProductionReadiness(env)).some((c) => c.id === "sign-up"))
      })

      it(`${name}: neither flag is unchanged`, () => {
        assert.notEqual(signUp(base)?.status, "fail")
        assert.notEqual(signUp(base)?.status, "warn")
      })
    }

    it("the Production fixture with both flags has no failures at all", () => {
      assert.deepEqual(ids(evaluateProductionReadiness({ ...production, AUTH_ALLOW_SIGN_UP: "true", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }).failures), [])
    })

    it("with verification mail on, the unverified flag is reported as having no effect", () => {
      const mail = { MAIL_TRANSPORT: "resend", MAIL_FROM: "noreply@mail.matchbase.example", RESEND_API_KEY: "re_TestKey_0123456789abcdef", AUTH_EMAIL_VERIFICATION_ENABLED: "true" }
      const check = signUp({ ...production, ...mail, AUTH_ALLOW_SIGN_UP: "true", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" })
      assert.equal(check?.status, "warn")
      assert.match(check?.detail ?? "", /required email verification.*AUTH_ALLOW_UNVERIFIED_SIGN_UP is set but has no effect/)
    })

    it("development never fails on the flags", () => {
      const dev = { DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB_DIRECT, BETTER_AUTH_SECRET: SECRET, MATCHBASE_DATABASE_LABEL: "development" }
      assert.equal(signUp({ ...dev, AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" })?.status, "info")
      assert.equal(signUp({ ...dev, AUTH_ALLOW_SIGN_UP: "false", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" })?.status, "info")
    })
  })

  it("Preview blocks only what could reach Production", () => {
    const preview = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "matchbase-git-x.vercel.app", MATCHBASE_DATABASE_LABEL: "preview", MATCHBASE_DATABASE_ENDPOINT: "ep-test-fixture-a1b2c3d4", DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB_DIRECT, BETTER_AUTH_SECRET: SECRET }
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
    assert.match(evaluateProductionReadiness({ ...production, ...resend }).checks.find((c) => c.id === "email-verification")?.detail ?? "", /disabled.*public sign-up opens only with both AUTH_ALLOW_SIGN_UP=true and AUTH_ALLOW_UNVERIFIED_SIGN_UP=true/)
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
