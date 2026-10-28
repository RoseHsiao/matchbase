import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { accountPolicy } from "../../lib/auth/email-verification"
import { buildEmailVerificationUrl, normalizeEmailVerificationUrl } from "../../lib/auth/reset-link"
import { readVerificationTokenFromHash } from "../../lib/auth/reset-token-fragment"
import { EMAIL_VERIFICATION_KIND, emailVerificationEmail } from "../../lib/mail/templates/email-verification"

const RESEND = { MAIL_TRANSPORT: "resend", MAIL_FROM: "noreply@mail.matchbase.example", RESEND_API_KEY: "re_TestKey_0123456789abcdef" }
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFAZXhhbXBsZS5jb20ifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ"

describe("accountPolicy", () => {
  it("Production today (no variables): sign-up closed, verification not required (no lockout), no verification mail", () => {
    assert.deepEqual(accountPolicy({ VERCEL_ENV: "production" }), { environment: "production", signUpRequested: false, signUpOpen: false, requireEmailVerification: false, verificationMail: false, refusal: null })
  })

  it("Production with mail but sign-up closed: verification optional, mail available", () => {
    const policy = accountPolicy({ VERCEL_ENV: "production", ...RESEND })
    assert.equal(policy.signUpOpen, false)
    assert.equal(policy.requireEmailVerification, false)
    assert.equal(policy.verificationMail, true)
  })

  it("Production sign-up opens only with AUTH_ALLOW_SIGN_UP=true and deliverable mail, and then requires verification", () => {
    const refused = accountPolicy({ VERCEL_ENV: "production", AUTH_ALLOW_SIGN_UP: "true" })
    assert.equal(refused.signUpOpen, false)
    assert.match(refused.refusal ?? "", /stays closed/)
    const open = accountPolicy({ VERCEL_ENV: "production", AUTH_ALLOW_SIGN_UP: "true", ...RESEND })
    assert.equal(open.signUpOpen, true)
    assert.equal(open.requireEmailVerification, true)
    assert.equal(accountPolicy({ VERCEL_ENV: "production", ...RESEND }).signUpOpen, false, "mail alone never opens sign-up")
  })

  it("Preview follows the same rule; a refused mail configuration counts as no mail", () => {
    assert.equal(accountPolicy({ VERCEL_ENV: "preview", AUTH_ALLOW_SIGN_UP: "true", ...RESEND }).signUpOpen, false, "Resend without an allowlist is refused on Preview")
    assert.equal(accountPolicy({ VERCEL_ENV: "preview", AUTH_ALLOW_SIGN_UP: "true", ...RESEND, MAIL_ALLOWED_RECIPIENTS: "t@example.com" }).requireEmailVerification, true)
  })

  it("development keeps the open, unverified form without mail and requires verification with the outbox", () => {
    assert.deepEqual(accountPolicy({}), { environment: "development", signUpRequested: true, signUpOpen: true, requireEmailVerification: false, verificationMail: false, refusal: null })
    assert.equal(accountPolicy({ MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com" }).requireEmailVerification, true)
    assert.equal(accountPolicy({ AUTH_ALLOW_SIGN_UP: "false" }).signUpOpen, false)
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
