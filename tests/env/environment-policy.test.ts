import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { accountPolicy } from "../../lib/auth/email-verification"
import { resolveDevLogin } from "../../lib/auth/dev-login"
import { databaseLabelPolicy, operatorPolicy, providerSyncPolicy, readDatabaseLabel, resolveRuntimePlatform, seedPolicy } from "../../lib/env/runtime-environment"

/**
 * The environment model: one interpretation, every dangerous operation
 * asks it. Development, Preview and Production each get the intended
 * answers, and no flag can talk a Preview or a developer shell into
 * touching a Production-labelled database silently.
 */

const devLogin = {
  MATCHBASE_DEV_LOGIN: "true",
  MATCHBASE_DEV_USER_EMAIL: "dev-user@matchbase.local",
  MATCHBASE_DEV_USER_PASSWORD: "dev-user-password-1",
  MATCHBASE_DEV_ADMIN_EMAIL: "dev-admin@matchbase.local",
  MATCHBASE_DEV_ADMIN_PASSWORD: "dev-admin-password-1",
}

describe("platform", () => {
  it("distinguishes Vercel, self-hosted and local", () => {
    assert.equal(resolveRuntimePlatform({ VERCEL: "1", VERCEL_ENV: "production" }), "vercel")
    assert.equal(resolveRuntimePlatform({ NODE_ENV: "production" }), "self-hosted")
    assert.equal(resolveRuntimePlatform({}), "local")
  })
})

describe("database label", () => {
  it("reads only the three known labels", () => {
    assert.equal(readDatabaseLabel({ MATCHBASE_DATABASE_LABEL: " Production " }), "production")
    assert.equal(readDatabaseLabel({ MATCHBASE_DATABASE_LABEL: "prod" }), undefined)
    assert.equal(readDatabaseLabel({}), undefined)
  })
  it("Production requires the production label", () => {
    assert.match(databaseLabelPolicy({ VERCEL_ENV: "production" }).mismatch ?? "", /requires MATCHBASE_DATABASE_LABEL=production/)
    assert.match(databaseLabelPolicy({ VERCEL_ENV: "production", MATCHBASE_DATABASE_LABEL: "preview" }).mismatch ?? "", /production/)
    assert.equal(databaseLabelPolicy({ VERCEL_ENV: "production", MATCHBASE_DATABASE_LABEL: "production" }).mismatch, null)
  })
  it("Preview and development refuse a production-labelled database", () => {
    assert.match(databaseLabelPolicy({ VERCEL_ENV: "preview", MATCHBASE_DATABASE_LABEL: "production" }).mismatch ?? "", /Production database/)
    assert.match(databaseLabelPolicy({ MATCHBASE_DATABASE_LABEL: "production" }).mismatch ?? "", /development/)
    const preview = databaseLabelPolicy({ VERCEL_ENV: "preview", MATCHBASE_DATABASE_LABEL: "preview" })
    assert.equal(preview.mismatch, null)
    assert.equal(preview.warning, null)
    const unlabelled = databaseLabelPolicy({})
    assert.equal(unlabelled.mismatch, null)
    assert.match(unlabelled.warning ?? "", /unset/)
    assert.match(databaseLabelPolicy({ MATCHBASE_DATABASE_LABEL: "staging" }).mismatch ?? "", /must be one of/)
  })
})

describe("operator confirmation", () => {
  it("is required only for a production-labelled database", () => {
    assert.deepEqual(operatorPolicy({}), { allowed: true, target: "unlabelled" })
    assert.deepEqual(operatorPolicy({ MATCHBASE_DATABASE_LABEL: "preview" }), { allowed: true, target: "preview" })
    const refused = operatorPolicy({ MATCHBASE_DATABASE_LABEL: "production" })
    assert.equal(refused.allowed, false)
    assert.match(refused.allowed ? "" : refused.reason, /MATCHBASE_OPERATOR_TARGET=production/)
    assert.deepEqual(operatorPolicy({ MATCHBASE_DATABASE_LABEL: "production", MATCHBASE_OPERATOR_TARGET: "production" }), { allowed: true, target: "production" })
    assert.equal(operatorPolicy({ MATCHBASE_DATABASE_LABEL: "production", MATCHBASE_OPERATOR_TARGET: "preview" }).allowed, false)
  })
})

describe("seed policy", () => {
  it("allows development, notes preview, refuses production by default", () => {
    assert.deepEqual(seedPolicy({}), { allowed: true, note: null })
    const preview = seedPolicy({ VERCEL_ENV: "preview", MATCHBASE_DATABASE_LABEL: "preview" })
    assert.equal(preview.allowed, true)
    assert.match(preview.allowed ? preview.note ?? "" : "", /Preview/)
    for (const env of [{ VERCEL_ENV: "production", MATCHBASE_DATABASE_LABEL: "production", MATCHBASE_OPERATOR_TARGET: "production" }, { NODE_ENV: "production" }, { MATCHBASE_DATABASE_LABEL: "production", MATCHBASE_OPERATOR_TARGET: "production" }]) {
      const verdict = seedPolicy(env)
      assert.equal(verdict.allowed, false, JSON.stringify(env))
      assert.match(verdict.allowed ? "" : verdict.reason, /refused for Production/)
    }
  })
  it("a production seed needs the flag and the operator confirmation", () => {
    assert.equal(seedPolicy({ MATCHBASE_DATABASE_LABEL: "production", ALLOW_PRODUCTION_SEED: "true" }).allowed, false, "confirmation missing")
    assert.equal(seedPolicy({ VERCEL_ENV: "production", MATCHBASE_DATABASE_LABEL: "production", ALLOW_PRODUCTION_SEED: "true" }).allowed, false)
    const allowed = seedPolicy({ VERCEL_ENV: "production", MATCHBASE_DATABASE_LABEL: "production", ALLOW_PRODUCTION_SEED: "true", MATCHBASE_OPERATOR_TARGET: "production" })
    assert.equal(allowed.allowed, true)
    assert.match(allowed.allowed ? allowed.note ?? "" : "", /ALLOW_PRODUCTION_SEED/)
  })
})

describe("launch sign-up policy", () => {
  it("is closed outside development unless both flags (or verification mail) open it; development is unchanged", () => {
    const open = (env: Record<string, string | undefined>) => accountPolicy(env).signUpOpen
    assert.equal(open({}), true)
    assert.equal(open({ AUTH_ALLOW_SIGN_UP: "" }), true, "an empty value is unset")
    assert.equal(open({ AUTH_ALLOW_SIGN_UP: "false" }), false)
    for (const base of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { NODE_ENV: "production" }]) {
      assert.equal(open(base), false, JSON.stringify(base))
      assert.equal(open({ ...base, AUTH_ALLOW_SIGN_UP: "true" }), false, "one flag is refused")
      assert.equal(open({ ...base, AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }), false, "one flag is refused")
      assert.equal(open({ ...base, AUTH_ALLOW_SIGN_UP: "", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "" }), false, "empty values are unset")
      assert.equal(open({ ...base, AUTH_ALLOW_SIGN_UP: "true", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }), true)
    }
  })

  it("only accountPolicy reads the sign-up flags; no other module can answer the question differently", async () => {
    const { readdirSync, readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const files = ["app", "components", "lib", "proxy.ts", "instrumentation.ts"].flatMap((root) =>
      root.endsWith(".ts") ? [root] : readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) => /\.tsx?$/.test(name)).map((name) => join(root, name))
    ).filter((file) => !file.startsWith("lib/generated/"))
    const reads = /env(\?)?\.AUTH_ALLOW_(UNVERIFIED_)?SIGN_UP\b|env\[\s*["'`]AUTH_ALLOW_(UNVERIFIED_)?SIGN_UP["'`]\s*\]|env\[(SIGN_UP_FLAG|UNVERIFIED_SIGN_UP_FLAG)\]/
    const readers = files.filter((file) => reads.test(readFileSync(file, "utf8")))
    assert.deepEqual(readers, ["lib/auth/email-verification.ts"])
    for (const name of ["isSignUpAllowed", "signUpPolicy", "allowSignUp"]) {
      assert.ok(!files.some((file) => new RegExp(`\\b${name}\\b`).test(readFileSync(file, "utf8"))), `${name} is gone`)
    }
  })
})

describe("cross-checks between policies", () => {
  it("Production and Preview never get dev quick login or provider sync by default", () => {
    assert.equal(resolveDevLogin({ ...devLogin, VERCEL_ENV: "production", MATCHBASE_DATABASE_LABEL: "production" }).enabled, false)
    assert.equal(resolveDevLogin({ ...devLogin, VERCEL_ENV: "preview" }).enabled, false)
    assert.equal(providerSyncPolicy({ VERCEL_ENV: "preview" }).allowed, false)
    assert.equal(providerSyncPolicy({ VERCEL_ENV: "production" }).allowed, true)
  })
})
