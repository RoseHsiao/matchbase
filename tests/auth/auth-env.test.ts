import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { AuthConfigError, isSignUpAllowed, readAuthEnv, resolveAuthBaseUrl } from "../../lib/auth/auth-env"
import { isFlagEnabled, providerSyncPolicy, resolveRuntimeEnvironment } from "../../lib/env/runtime-environment"

const SECRET = "0123456789abcdef0123456789abcdef0123456789"

describe("resolveRuntimeEnvironment", () => {
  it("honours VERCEL_ENV over NODE_ENV", () => {
    assert.equal(resolveRuntimeEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" }), "preview")
    assert.equal(resolveRuntimeEnvironment({ VERCEL_ENV: "Production" }), "production")
    assert.equal(resolveRuntimeEnvironment({ VERCEL_ENV: "development", NODE_ENV: "production" }), "development")
  })
  it("falls back to NODE_ENV outside Vercel and ignores unknown values", () => {
    assert.equal(resolveRuntimeEnvironment({ NODE_ENV: "production" }), "production")
    assert.equal(resolveRuntimeEnvironment({ NODE_ENV: "test" }), "development")
    assert.equal(resolveRuntimeEnvironment({}), "development")
    assert.equal(resolveRuntimeEnvironment({ VERCEL_ENV: "staging", NODE_ENV: "production" }), "production")
  })
})

describe("providerSyncPolicy (Preview isolation)", () => {
  it("allows production and development", () => {
    assert.deepEqual(providerSyncPolicy({ VERCEL_ENV: "production" }), { allowed: true })
    assert.deepEqual(providerSyncPolicy({}), { allowed: true })
  })
  it("refuses preview unless explicitly opted in", () => {
    const refused = providerSyncPolicy({ VERCEL_ENV: "preview" })
    assert.equal(refused.allowed, false)
    assert.match(refused.allowed ? "" : refused.reason, /Preview/)
    assert.equal(providerSyncPolicy({ VERCEL_ENV: "preview", ALLOW_PREVIEW_PROVIDER_SYNC: "false" }).allowed, false)
    assert.equal(providerSyncPolicy({ VERCEL_ENV: "preview", ALLOW_PREVIEW_PROVIDER_SYNC: "true" }).allowed, true)
    assert.equal(providerSyncPolicy({ VERCEL_ENV: "preview", ALLOW_PREVIEW_PROVIDER_SYNC: "1" }).allowed, true)
  })
  it("isFlagEnabled accepts the usual spellings only", () => {
    for (const on of ["1", "true", "TRUE", "yes", "on", " on "]) assert.equal(isFlagEnabled(on), true, on)
    for (const off of [undefined, "", "0", "false", "no", "off", "enabled", "2"]) assert.equal(isFlagEnabled(off), false, String(off))
  })
})

describe("resolveAuthBaseUrl", () => {
  it("prefers BETTER_AUTH_URL, normalising scheme and trailing slash", () => {
    assert.equal(resolveAuthBaseUrl({ BETTER_AUTH_URL: "https://matchbase.example/" }), "https://matchbase.example")
    assert.equal(resolveAuthBaseUrl({ BETTER_AUTH_URL: "matchbase.example" }), "https://matchbase.example")
    assert.equal(resolveAuthBaseUrl({ BETTER_AUTH_URL: "http://localhost:3000", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" }), "http://localhost:3000")
  })
  it("derives the Vercel URLs per environment and nothing locally", () => {
    assert.equal(resolveAuthBaseUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "matchbase.example", VERCEL_URL: "dep-123.vercel.app" }), "https://matchbase.example")
    assert.equal(resolveAuthBaseUrl({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "matchbase.example", VERCEL_URL: "dep-123.vercel.app" }), "https://dep-123.vercel.app")
    assert.equal(resolveAuthBaseUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "site-git-x.vercel.app" }), "https://site-git-x.vercel.app")
    assert.equal(resolveAuthBaseUrl({}), undefined)
    assert.equal(resolveAuthBaseUrl({ VERCEL_URL: "dep.vercel.app" }), undefined)
  })
})

describe("readAuthEnv", () => {
  it("requires a real secret", () => {
    assert.throws(() => readAuthEnv({}), AuthConfigError)
    assert.throws(() => readAuthEnv({ BETTER_AUTH_SECRET: "short" }), /at least 32/)
  })
  it("requires an explicit base URL outside development", () => {
    assert.throws(() => readAuthEnv({ BETTER_AUTH_SECRET: SECRET, NODE_ENV: "production" }), /BETTER_AUTH_URL/)
    assert.throws(() => readAuthEnv({ BETTER_AUTH_SECRET: SECRET, VERCEL_ENV: "preview" }), AuthConfigError)
    assert.equal(readAuthEnv({ BETTER_AUTH_SECRET: SECRET }).baseURL, undefined)
  })
  it("trusts only the deployment origin, plus production from a preview", () => {
    const prod = readAuthEnv({ BETTER_AUTH_SECRET: SECRET, VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "matchbase.example", VERCEL_URL: "dep.vercel.app" })
    assert.deepEqual(prod.trustedOrigins, ["https://matchbase.example"])
    const preview = readAuthEnv({ BETTER_AUTH_SECRET: SECRET, VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "matchbase.example", VERCEL_URL: "dep.vercel.app", VERCEL_BRANCH_URL: "site-git-x.vercel.app" })
    assert.deepEqual(preview.trustedOrigins, ["https://dep.vercel.app", "https://site-git-x.vercel.app", "https://matchbase.example"])
    assert.equal(preview.environment, "preview")
    // An explicit BETTER_AUTH_URL on a preview still keeps both generated hosts trusted; nothing is wildcarded.
    const explicitPreview = readAuthEnv({ BETTER_AUTH_SECRET: SECRET, VERCEL_ENV: "preview", BETTER_AUTH_URL: "https://staging.example", VERCEL_URL: "dep.vercel.app", VERCEL_BRANCH_URL: "site-git-x.vercel.app" })
    assert.deepEqual(explicitPreview.trustedOrigins, ["https://staging.example", "https://dep.vercel.app", "https://site-git-x.vercel.app"])
    assert.equal(explicitPreview.trustedOrigins.some((o) => o.includes("*")), false)
  })
  it("sign-up is open by default and closes with AUTH_ALLOW_SIGN_UP=false", () => {
    assert.equal(isSignUpAllowed({}), true)
    assert.equal(isSignUpAllowed({ AUTH_ALLOW_SIGN_UP: "true" }), true)
    assert.equal(isSignUpAllowed({ AUTH_ALLOW_SIGN_UP: "false" }), false)
    assert.equal(isSignUpAllowed({ AUTH_ALLOW_SIGN_UP: "0" }), false)
    assert.equal(readAuthEnv({ BETTER_AUTH_SECRET: SECRET, AUTH_ALLOW_SIGN_UP: "no" }).allowSignUp, false)
  })
})
