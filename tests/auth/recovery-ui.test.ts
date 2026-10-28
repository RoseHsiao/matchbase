import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { ForgotPasswordForm } from "../../components/auth/forgot-password-form"
import { ResetPasswordForm } from "../../components/auth/reset-password-form"
import { describeAuthError } from "../../lib/auth/client"
import { safeNextPath } from "../../lib/auth/redirect"
import { readResetTokenFromHash } from "../../lib/auth/reset-token-fragment"

const TOKEN = "q8Zr2Kd9LmN4pX7wT1vB3cYh"

describe("reset token fragment", () => {
  it("reads exactly one well-formed token parameter", () => {
    assert.equal(readResetTokenFromHash(`#token=${TOKEN}`), TOKEN)
    for (const hash of ["", "#", "#token=", "#token=short", `#token=${TOKEN}&x=1`, `#x=1&token=${TOKEN}`, `?token=${TOKEN}`, `#token=${TOKEN}%3Cscript`, `#token=${"a".repeat(300)}`, `#TOKEN=${TOKEN}`]) {
      assert.equal(readResetTokenFromHash(hash), null, hash)
    }
  })
})

describe("recovery pages are never post-sign-in destinations", () => {
  it("safeNextPath refuses them", () => {
    for (const path of ["/forgot-password", "/reset-password", "/reset-password#token=abc", "/verify-email"]) assert.equal(safeNextPath(path), "/dashboard", path)
  })
})

describe("recovery error messages", () => {
  it("are fixed sentences that name no internals", () => {
    assert.match(describeAuthError({ code: "INVALID_TOKEN" }), /invalid, expired or already used/)
    assert.equal(describeAuthError({ code: "TOKEN_EXPIRED" }), describeAuthError({ code: "INVALID_TOKEN" }), "expired and used links read the same")
    assert.match(describeAuthError({ code: "RESET_PASSWORD_DISABLED" }), /not available/)
    assert.match(describeAuthError({ status: 429 }), /Too many attempts/)
  })
})

describe("server-rendered recovery markup", () => {
  it("the reset page's server HTML is a neutral shell: no form, no token, nothing to leak", () => {
    const html = renderToStaticMarkup(createElement(ResetPasswordForm))
    assert.match(html, /Checking your reset link/)
    assert.doesNotMatch(html, /<form|token|type="password"/i)
  })

  it("with recovery unavailable, the request page offers no form and does not pretend to send", () => {
    const html = renderToStaticMarkup(createElement(ForgotPasswordForm, { available: false, lifetimeMinutes: 30 }))
    assert.match(html, /Password reset is not available/)
    assert.match(html, /contact the operator/)
    assert.doesNotMatch(html, /<form|Check your email|on its way/i)
  })

  it("with recovery available, the request page is a labelled email form", () => {
    const html = renderToStaticMarkup(createElement(ForgotPasswordForm, { available: true, lifetimeMinutes: 30 }))
    assert.match(html, /<label[^>]*for="forgot-email"[^>]*>Email<\/label>/)
    assert.match(html, /<input[^>]*id="forgot-email"[^>]*type="email"/)
    assert.match(html, /Send reset link/)
  })
})
