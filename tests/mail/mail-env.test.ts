import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { isSignUpAllowed } from "../../lib/auth/auth-env"
import { DEFAULT_MAIL_DAILY_CAP, parseSender, readMailEnv } from "../../lib/mail/mail-env"
import { isRecipientAllowed, readRecipientPolicy } from "../../lib/mail/recipient-policy"

const KEY = "re_TestKey_0123456789abcdef"
const DEV = { NODE_ENV: "development" }
const PREVIEW = { VERCEL_ENV: "preview" }
const PRODUCTION = { VERCEL_ENV: "production" }

function errorsOf(env: Record<string, string>): string[] {
  return readMailEnv(env).issues.filter((issue) => issue.severity === "error").map((issue) => issue.variable)
}

describe("readMailEnv: nothing configured", () => {
  for (const [name, base] of [["development", DEV], ["preview", PREVIEW], ["production", PRODUCTION]] as const) {
    it(`${name}: mail is disabled, recovery off, no issues`, () => {
      const config = readMailEnv(base)
      assert.equal(config.environment, name)
      assert.equal(config.transport.kind, "disabled")
      assert.equal(config.passwordReset.enabled, false)
      assert.equal(config.passwordReset.requested, false)
      assert.deepEqual(config.issues, [])
      assert.equal(config.dailyCap, DEFAULT_MAIL_DAILY_CAP)
    })
  }

  it("Production without any mail variable is a valid configuration today (recovery disabled)", () => {
    assert.deepEqual(errorsOf(PRODUCTION), [])
  })

  it("an unknown transport (including the test-only capture) is refused and disabled", () => {
    for (const value of ["capture", "smtp", "Resend2"]) {
      const config = readMailEnv({ ...DEV, MAIL_TRANSPORT: value, MAIL_FROM: "dev@example.com" })
      assert.equal(config.transport.kind, "disabled", value)
      assert.deepEqual(errorsOf({ ...DEV, MAIL_TRANSPORT: value, MAIL_FROM: "dev@example.com" }), ["MAIL_TRANSPORT"])
    }
  })
})

describe("readMailEnv: dev-outbox", () => {
  it("is allowed in development", () => {
    const config = readMailEnv({ ...DEV, MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "MatchBase <dev@example.com>" })
    assert.deepEqual(config.transport, { kind: "dev-outbox", from: "MatchBase <dev@example.com>", replyTo: undefined })
    assert.deepEqual(config.issues, [])
  })

  it("is refused in Preview and Production, falling back to disabled", () => {
    for (const base of [PREVIEW, PRODUCTION, { NODE_ENV: "production" }]) {
      const env = { ...base, MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com" }
      const config = readMailEnv(env)
      assert.equal(config.transport.kind, "disabled")
      assert.match(config.transport.kind === "disabled" ? config.transport.reason : "", /refused/)
      assert.deepEqual(errorsOf(env), ["MAIL_TRANSPORT"])
    }
  })

  it("Production cannot enable recovery through dev-outbox", () => {
    const config = readMailEnv({ ...PRODUCTION, MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com", AUTH_PASSWORD_RESET_ENABLED: "true" })
    assert.equal(config.passwordReset.enabled, false)
  })
})

describe("readMailEnv: resend", () => {
  const resend = { MAIL_TRANSPORT: "resend", MAIL_FROM: "MatchBase <noreply@mail.example.com>", RESEND_API_KEY: KEY }

  it("Production uses Resend with no allowlist", () => {
    const config = readMailEnv({ ...PRODUCTION, ...resend })
    assert.equal(config.transport.kind, "resend")
    assert.deepEqual(config.transport.kind === "resend" ? config.transport.recipients : null, { mode: "all" })
    assert.deepEqual(config.issues, [])
  })

  it("Production refuses an allowlist (a leaked Preview setting) instead of silently narrowing delivery", () => {
    const env = { ...PRODUCTION, ...resend, MAIL_ALLOWED_RECIPIENTS: "me@example.com" }
    assert.equal(readMailEnv(env).transport.kind, "disabled")
    assert.deepEqual(errorsOf(env), ["MAIL_ALLOWED_RECIPIENTS"])
  })

  it("Preview and development require an allowlist", () => {
    for (const base of [PREVIEW, DEV]) {
      assert.equal(readMailEnv({ ...base, ...resend }).transport.kind, "disabled")
      assert.deepEqual(errorsOf({ ...base, ...resend }), ["MAIL_ALLOWED_RECIPIENTS"])
      const allowed = readMailEnv({ ...base, ...resend, MAIL_ALLOWED_RECIPIENTS: "Me@Example.com, second@example.com" })
      assert.equal(allowed.transport.kind, "resend")
      const policy = allowed.transport.kind === "resend" ? allowed.transport.recipients : { mode: "all" as const }
      assert.equal(policy.mode, "allowlist")
      assert.equal(isRecipientAllowed(policy, "me@example.com"), true)
      assert.equal(isRecipientAllowed(policy, "SECOND@example.com"), true)
      assert.equal(isRecipientAllowed(policy, "someone@example.com"), false)
    }
  })

  it("a missing or malformed API key disables mail without echoing the value", () => {
    for (const key of [undefined, "", "sk_live_abcdef1234567890", "re_short", "re_has space in it"]) {
      const env = { ...PRODUCTION, ...resend, RESEND_API_KEY: key as string }
      const config = readMailEnv(env)
      assert.equal(config.transport.kind, "disabled")
      assert.deepEqual(errorsOf(env), ["RESEND_API_KEY"])
      if (key) for (const issue of config.issues) assert.ok(!issue.message.includes(key))
    }
  })

  it("MAIL_FROM and MAIL_REPLY_TO must be single, single-line addresses", () => {
    for (const from of [undefined, "", "not-an-address", "a@example.com, b@example.com", "Evil\r\nBcc: x@example.com <a@example.com>", "a@example.com\nBcc: b@example.com"]) {
      const env = { ...PRODUCTION, ...resend, MAIL_FROM: from as string }
      assert.equal(readMailEnv(env).transport.kind, "disabled", JSON.stringify(from))
      assert.deepEqual(errorsOf(env), ["MAIL_FROM"])
    }
    const badReply = { ...PRODUCTION, ...resend, MAIL_REPLY_TO: "a@example.com, b@example.com" }
    assert.deepEqual(errorsOf(badReply), ["MAIL_REPLY_TO"])
    const goodReply = readMailEnv({ ...PRODUCTION, ...resend, MAIL_REPLY_TO: "support@example.com" })
    assert.equal(goodReply.transport.kind === "resend" ? goodReply.transport.replyTo : null, "support@example.com")
  })

  it("an invalid allowlist is refused without naming its entries", () => {
    const env = { ...PREVIEW, ...resend, MAIL_ALLOWED_RECIPIENTS: "me@example.com, secret-person-at-example" }
    const config = readMailEnv(env)
    assert.equal(config.transport.kind, "disabled")
    assert.deepEqual(errorsOf(env), ["MAIL_ALLOWED_RECIPIENTS"])
    for (const issue of config.issues) assert.ok(!issue.message.includes("secret-person") && !issue.message.includes("me@example.com"))
  })
})

describe("readMailEnv: password recovery availability", () => {
  const resendProd = { ...PRODUCTION, MAIL_TRANSPORT: "resend", RESEND_API_KEY: KEY }

  it("is off unless requested, whatever the transport", () => {
    assert.equal(readMailEnv({ ...resendProd, MAIL_FROM: "noreply@mail.example.com" }).passwordReset.enabled, false)
  })

  it("requested without a deliverable transport stays off and reports an error", () => {
    for (const base of [DEV, PREVIEW, PRODUCTION]) {
      const env = { ...base, AUTH_PASSWORD_RESET_ENABLED: "true" }
      const config = readMailEnv(env)
      assert.deepEqual(config.passwordReset.enabled, false)
      assert.equal(config.passwordReset.requested, true)
      assert.deepEqual(errorsOf(env), ["AUTH_PASSWORD_RESET_ENABLED"])
    }
  })

  it("Production refuses Resend's shared test domain: a sending domain of our own is required", () => {
    for (const from of ["onboarding@resend.dev", "MatchBase <noreply@resend.dev>", "x@sub.resend.dev"]) {
      const env = { ...resendProd, MAIL_FROM: from, AUTH_PASSWORD_RESET_ENABLED: "true" }
      const config = readMailEnv(env)
      assert.equal(config.transport.kind, "disabled", "a Production Resend transport on the test domain is refused outright")
      assert.equal(config.passwordReset.enabled, false, from)
      assert.deepEqual(errorsOf(env), ["MAIL_FROM", "AUTH_PASSWORD_RESET_ENABLED"])
      assert.deepEqual(errorsOf({ ...resendProd, MAIL_FROM: from }), ["MAIL_FROM"], "also without the recovery flag")
    }
  })

  it("is available with Resend from an own domain in Production, and with dev-outbox in development", () => {
    assert.equal(readMailEnv({ ...resendProd, MAIL_FROM: "noreply@mail.example.com", AUTH_PASSWORD_RESET_ENABLED: "true" }).passwordReset.enabled, true)
    assert.equal(readMailEnv({ ...DEV, MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com", AUTH_PASSWORD_RESET_ENABLED: "1" }).passwordReset.enabled, true)
  })

  it("never changes the sign-up policy", () => {
    const env = { ...resendProd, MAIL_FROM: "noreply@mail.example.com", AUTH_PASSWORD_RESET_ENABLED: "true" }
    assert.equal(isSignUpAllowed(env), false)
  })
})

describe("readMailEnv: daily cap", () => {
  it("accepts a whole number in range and warns (not fails) otherwise", () => {
    assert.equal(readMailEnv({ ...DEV, MAIL_DAILY_CAP: "25" }).dailyCap, 25)
    for (const value of ["0", "-1", "1.5", "abc", "100000"]) {
      const config = readMailEnv({ ...DEV, MAIL_DAILY_CAP: value })
      assert.equal(config.dailyCap, DEFAULT_MAIL_DAILY_CAP, value)
      assert.deepEqual(config.issues.map((issue) => issue.severity), ["warning"])
    }
  })
})

describe("parseSender and readRecipientPolicy", () => {
  it("parses plain and named senders", () => {
    assert.deepEqual(parseSender("noreply@mail.example.com"), { address: "noreply@mail.example.com", formatted: "noreply@mail.example.com" })
    assert.deepEqual(parseSender("  MatchBase   <NoReply@Mail.Example.com> "), { address: "noreply@mail.example.com", formatted: "MatchBase <NoReply@Mail.Example.com>" })
    assert.equal(parseSender("<a@example.com>"), null)
    assert.equal(parseSender('"Quoted" <a@example.com>'), null)
  })

  it("blank means no allowlist; too many entries is refused", () => {
    assert.deepEqual(readRecipientPolicy(undefined), { ok: true, policy: { mode: "all" } })
    assert.deepEqual(readRecipientPolicy(" , "), { ok: true, policy: { mode: "all" } })
    const many = Array.from({ length: 21 }, (_, i) => `p${i}@example.com`).join(",")
    assert.equal(readRecipientPolicy(many).ok, false)
  })
})
