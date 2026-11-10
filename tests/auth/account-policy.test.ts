import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { accountPolicy } from "../../lib/auth/email-verification"
import { buildEmailVerificationUrl, normalizeEmailVerificationUrl } from "../../lib/auth/reset-link"
import { readVerificationTokenFromHash } from "../../lib/auth/reset-token-fragment"
import { EMAIL_VERIFICATION_KIND, emailVerificationEmail } from "../../lib/mail/templates/email-verification"

const RESEND = { MAIL_TRANSPORT: "resend", MAIL_FROM: "noreply@mail.matchbase.example", RESEND_API_KEY: "re_TestKey_0123456789abcdef" }
/** Verification mail is its own switch: a transport plus AUTH_EMAIL_VERIFICATION_ENABLED. */
const VERIFY = { ...RESEND, AUTH_EMAIL_VERIFICATION_ENABLED: "true" }
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFAZXhhbXBsZS5jb20ifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ"

describe("accountPolicy", () => {
  it("Production today (no variables): sign-up closed, verification not required (no lockout), no verification mail", () => {
    assert.deepEqual(accountPolicy({ VERCEL_ENV: "production" }), { environment: "production", signUpRequested: false, signUpOpen: false, requireEmailVerification: false, verificationMail: false, unverifiedRequested: false, unverifiedSignUp: false, refusal: null })
  })

  it("a transport alone turns nothing on: no verification mail, and requested sign-up stays refused", () => {
    const policy = accountPolicy({ VERCEL_ENV: "production", ...RESEND })
    assert.equal(policy.verificationMail, false)
    const requested = accountPolicy({ VERCEL_ENV: "production", ...RESEND, AUTH_ALLOW_SIGN_UP: "true" })
    assert.equal(requested.signUpOpen, false)
    assert.match(requested.refusal ?? "", /AUTH_EMAIL_VERIFICATION_ENABLED/)
    assert.equal(accountPolicy({ VERCEL_ENV: "production", AUTH_EMAIL_VERIFICATION_ENABLED: "true" }).verificationMail, false, "the switch alone, without a transport, does nothing either")
  })

  it("Production with verification mail but sign-up closed: verification optional, mail available", () => {
    const policy = accountPolicy({ VERCEL_ENV: "production", ...VERIFY })
    assert.equal(policy.signUpOpen, false)
    assert.equal(policy.requireEmailVerification, false)
    assert.equal(policy.verificationMail, true)
  })

  it("Production sign-up opens only with AUTH_ALLOW_SIGN_UP=true and deliverable mail, and then requires verification", () => {
    const refused = accountPolicy({ VERCEL_ENV: "production", AUTH_ALLOW_SIGN_UP: "true" })
    assert.equal(refused.signUpOpen, false)
    assert.match(refused.refusal ?? "", /stays closed/)
    const open = accountPolicy({ VERCEL_ENV: "production", AUTH_ALLOW_SIGN_UP: "true", ...VERIFY })
    assert.equal(open.signUpOpen, true)
    assert.equal(open.requireEmailVerification, true)
    assert.equal(accountPolicy({ VERCEL_ENV: "production", ...VERIFY }).signUpOpen, false, "mail alone never opens sign-up")
  })

  it("Preview follows the same rule; a refused mail configuration counts as no mail", () => {
    assert.equal(accountPolicy({ VERCEL_ENV: "preview", AUTH_ALLOW_SIGN_UP: "true", ...VERIFY }).signUpOpen, false, "Resend without an allowlist is refused on Preview")
    assert.equal(accountPolicy({ VERCEL_ENV: "preview", AUTH_ALLOW_SIGN_UP: "true", ...VERIFY, MAIL_ALLOWED_RECIPIENTS: "t@example.com" }).requireEmailVerification, true)
  })

  it("development keeps the open, unverified form without verification mail and requires verification with the outbox and the switch", () => {
    assert.deepEqual(accountPolicy({}), { environment: "development", signUpRequested: true, signUpOpen: true, requireEmailVerification: false, verificationMail: false, unverifiedRequested: false, unverifiedSignUp: false, refusal: null })
    assert.equal(accountPolicy({ MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com" }).requireEmailVerification, false, "the outbox alone keeps the old form")
    assert.equal(accountPolicy({ MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com", AUTH_EMAIL_VERIFICATION_ENABLED: "true" }).requireEmailVerification, true)
    assert.equal(accountPolicy({ AUTH_ALLOW_SIGN_UP: "false" }).signUpOpen, false)
  })
})

describe("accountPolicy: unverified sign-up needs both flags on a deployment", () => {
  const BOTH = { AUTH_ALLOW_SIGN_UP: "true", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }

  for (const environment of ["production", "preview"] as const) {
    it(`${environment}: neither flag keeps sign-up closed, with no refusal`, () => {
      const policy = accountPolicy({ VERCEL_ENV: environment })
      assert.equal(policy.signUpOpen, false)
      assert.equal(policy.refusal, null)
      assert.equal(policy.unverifiedSignUp, false)
    })

    it(`${environment}: AUTH_ALLOW_SIGN_UP=true alone is refused and names the missing flag`, () => {
      const policy = accountPolicy({ VERCEL_ENV: environment, AUTH_ALLOW_SIGN_UP: "true" })
      assert.equal(policy.signUpOpen, false)
      assert.match(policy.refusal ?? "", /AUTH_ALLOW_UNVERIFIED_SIGN_UP=true is not set/)
    })

    it(`${environment}: AUTH_ALLOW_UNVERIFIED_SIGN_UP=true alone is refused (and with AUTH_ALLOW_SIGN_UP=false too)`, () => {
      for (const env of [{ AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }, { AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true", AUTH_ALLOW_SIGN_UP: "false" }]) {
        const policy = accountPolicy({ VERCEL_ENV: environment, ...env })
        assert.equal(policy.signUpOpen, false)
        assert.equal(policy.unverifiedRequested, true)
        assert.match(policy.refusal ?? "", /without AUTH_ALLOW_SIGN_UP=true; both flags are required/)
      }
    })

    it(`${environment}: both flags open sign-up without verification and mark it`, () => {
      assert.deepEqual(accountPolicy({ VERCEL_ENV: environment, ...BOTH }), { environment, signUpRequested: true, signUpOpen: true, requireEmailVerification: false, verificationMail: false, unverifiedRequested: true, unverifiedSignUp: true, refusal: null })
    })

    it(`${environment}: a false-like value is not a flag`, () => {
      for (const value of ["false", "0", "", "no", "maybe"]) {
        assert.equal(accountPolicy({ VERCEL_ENV: environment, AUTH_ALLOW_SIGN_UP: "true", AUTH_ALLOW_UNVERIFIED_SIGN_UP: value }).signUpOpen, false, value)
      }
    })
  }

  it("verification mail wins: both flags plus deliverable mail still require verification", () => {
    const policy = accountPolicy({ VERCEL_ENV: "production", ...BOTH, ...VERIFY })
    assert.equal(policy.signUpOpen, true)
    assert.equal(policy.requireEmailVerification, true)
    assert.equal(policy.unverifiedSignUp, false)
  })

  it("development ignores the new flag: the old open, unverified form, and AUTH_ALLOW_SIGN_UP=false still closes it without a refusal", () => {
    assert.equal(accountPolicy({ AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }).unverifiedSignUp, false)
    assert.equal(accountPolicy({ AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }).signUpOpen, true)
    const closed = accountPolicy({ AUTH_ALLOW_SIGN_UP: "false", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" })
    assert.equal(closed.signUpOpen, false)
    assert.equal(closed.refusal, null)
    assert.equal(accountPolicy({ VERCEL_ENV: "development", ...BOTH }).unverifiedSignUp, false)
  })
})

describe("verification link and template", () => {
  it("builds and checks /verify-email#token=<jwt> with the reset link's origin rules", () => {
    const link = buildEmailVerificationUrl("https://matchbase.example", JWT)
    assert.equal(link, `https://matchbase.example/verify-email#token=${JWT}`)
    assert.equal(normalizeEmailVerificationUrl(link!), link)
    assert.equal(readVerificationTokenFromHash(`#token=${JWT}`), JWT)
    for (const bad of [["http://matchbase.example", JWT], ["https://matchbase.example", "not-a-jwt"], ["https://matchbase.example", "a.b"], ["https://matchbase.example", "q8Zr2Kd9LmN4pX7wT1vB3cYh"]]) {
      assert.equal(buildEmailVerificationUrl(bad[0], bad[1]), null, bad.join(" "))
    }
    for (const bad of [`https://matchbase.example/verify-email?token=${JWT}`, `https://matchbase.example/reset-password#token=${JWT}`, `https://matchbase.example/api/auth/verify-email?token=${JWT}&callbackURL=%2F`]) {
      assert.equal(normalizeEmailVerificationUrl(bad), null, bad)
    }
  })

  it("renders a confirmation email with one action, the 1-hour lifetime, and no recipient or token in the subject", () => {
    const link = `https://matchbase.example/verify-email#token=${JWT}`
    const result = emailVerificationEmail({ to: "person@example.com", verifyUrl: link, name: `<b>Rose</b>` })
    assert.ok(result.ok)
    const { message } = result
    assert.equal(message.kind, EMAIL_VERIFICATION_KIND)
    assert.equal(message.subject, "Confirm your email for MatchBase")
    assert.match(message.text, /This link expires in 1 hour\./)
    assert.equal(message.text.split(link).length - 1, 1)
    assert.equal((message.html ?? "").split(link).length - 1, 1)
    assert.ok((message.html ?? "").includes("Hi &lt;b&gt;Rose&lt;/b&gt;,"))
    assert.ok(!message.subject.includes(JWT) && !`${message.text}${message.html}`.includes("person@example.com"))
    assert.doesNotMatch(message.html ?? "", /<img|<script|src=/i)
    assert.deepEqual(emailVerificationEmail({ to: "person@example.com", verifyUrl: `https://matchbase.example/verify-email?token=${JWT}` }), { ok: false, reason: "invalid-verification-url" })
  })
})

describe("Watchlist email-reminder offer", () => {
  it("follows the verification switch, not the mere presence of a transport", async () => {
    const { reminderEmailsAvailable } = await import("../../lib/notifications/preferences-ops")
    assert.equal(reminderEmailsAvailable({ VERCEL_ENV: "production" }), false)
    assert.equal(reminderEmailsAvailable({ VERCEL_ENV: "production", ...RESEND }), false, "a transport alone offers nothing")
    assert.equal(reminderEmailsAvailable({ VERCEL_ENV: "production", ...VERIFY }), true)
    assert.equal(reminderEmailsAvailable({ VERCEL_ENV: "production", AUTH_EMAIL_VERIFICATION_ENABLED: "true" }), false, "the switch without a transport offers nothing")
  })
})
