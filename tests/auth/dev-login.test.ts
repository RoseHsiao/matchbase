import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { describeDevAccounts, DEV_LOGIN_FLAG, resolveDevLogin } from "../../lib/auth/dev-login"

/**
 * The development quick sign-in must be impossible to activate anywhere but
 * a local development process, whatever else the environment says.
 */

const credentials = {
  MATCHBASE_DEV_USER_EMAIL: "dev-user@matchbase.local",
  MATCHBASE_DEV_USER_PASSWORD: "dev-user-password-1",
  MATCHBASE_DEV_ADMIN_EMAIL: "dev-admin@matchbase.local",
  MATCHBASE_DEV_ADMIN_PASSWORD: "dev-admin-password-1",
}
const complete = { [DEV_LOGIN_FLAG]: "true", ...credentials }

function reason(env: Record<string, string | undefined>): string {
  const policy = resolveDevLogin(env)
  return policy.enabled ? "ENABLED" : policy.reason
}

describe("resolveDevLogin: refusals that no variable can override", () => {
  it("refuses on Vercel production even with the flag and credentials", () => {
    assert.match(reason({ ...complete, VERCEL_ENV: "production" }), /refused in the production environment/)
    assert.match(reason({ ...complete, VERCEL_ENV: "production", NODE_ENV: "development" }), /production/)
  })
  it("refuses on Vercel preview even with the flag and credentials", () => {
    assert.match(reason({ ...complete, VERCEL_ENV: "preview" }), /refused in the preview environment/)
    assert.match(reason({ ...complete, VERCEL_ENV: "preview", ALLOW_PREVIEW_PROVIDER_SYNC: "true" }), /preview/)
  })
  it("refuses under NODE_ENV=production outside Vercel (next start, self-hosting)", () => {
    assert.match(reason({ ...complete, NODE_ENV: "production" }), /refused in the production environment/)
  })
  it("refuses an unknown VERCEL_ENV that falls back to production", () => {
    assert.match(reason({ ...complete, VERCEL_ENV: "staging", NODE_ENV: "production" }), /production/)
  })
})

describe("resolveDevLogin: opt-in and credential rules in development", () => {
  it("is disabled by default", () => {
    assert.match(reason({}), /MATCHBASE_DEV_LOGIN is not enabled/)
    assert.match(reason(credentials), /not enabled/)
    assert.match(reason({ ...credentials, [DEV_LOGIN_FLAG]: "false" }), /not enabled/)
    assert.match(reason({ ...credentials, [DEV_LOGIN_FLAG]: "yes please" }), /not enabled/)
  })
  it("requires both accounts with valid emails and policy-length passwords", () => {
    assert.match(reason({ [DEV_LOGIN_FLAG]: "true" }), /MATCHBASE_DEV_USER_EMAIL/)
    assert.match(reason({ ...complete, MATCHBASE_DEV_USER_PASSWORD: "short" }), /MATCHBASE_DEV_USER_PASSWORD must be 10 to 128/)
    assert.match(reason({ ...complete, MATCHBASE_DEV_ADMIN_EMAIL: "not-an-email" }), /MATCHBASE_DEV_ADMIN_EMAIL/)
    assert.match(reason({ ...complete, MATCHBASE_DEV_ADMIN_PASSWORD: undefined }), /MATCHBASE_DEV_ADMIN_PASSWORD/)
    assert.match(reason({ ...complete, MATCHBASE_DEV_ADMIN_EMAIL: credentials.MATCHBASE_DEV_USER_EMAIL }), /different email/)
  })
  it("enables in development with a USER and an ADMIN account, emails normalised", () => {
    const policy = resolveDevLogin({ ...complete, MATCHBASE_DEV_ADMIN_EMAIL: "  Dev-Admin@MatchBase.local " })
    assert.equal(policy.enabled, true)
    if (!policy.enabled) return
    assert.deepEqual(policy.accounts.map((a) => [a.role, a.email]), [["USER", "dev-user@matchbase.local"], ["ADMIN", "dev-admin@matchbase.local"]])
    assert.equal(resolveDevLogin({ ...complete, VERCEL_ENV: "development" }).enabled, true)
    assert.equal(resolveDevLogin({ ...complete, NODE_ENV: "test" }).enabled, true)
  })
  it("describeDevAccounts never exposes passwords", () => {
    const shown = describeDevAccounts(resolveDevLogin(complete))
    assert.deepEqual(shown, [{ role: "USER", email: "dev-user@matchbase.local" }, { role: "ADMIN", email: "dev-admin@matchbase.local" }])
    assert.equal(JSON.stringify(shown).includes("password"), false)
    assert.deepEqual(describeDevAccounts(resolveDevLogin({ ...complete, VERCEL_ENV: "preview" })), [])
  })
})
