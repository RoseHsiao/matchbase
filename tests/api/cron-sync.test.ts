import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { authorizeCronRequest, handleCronSync } from "../../lib/api/cron-sync"
import type { ScheduledSyncSummary } from "../../lib/data/sync/scheduler"

const SECRET = "test-cron-secret-0123456789"
const env = { CRON_SECRET: SECRET }
const summary: ScheduledSyncSummary = { trigger: "cron", startedAt: "2026-09-17T03:00:00.000Z", durationMs: 12, sources: [{ id: "ds-x", name: "X", outcome: "SUCCESS", records: 3, syncLogId: "log-1" }], counts: { SUCCESS: 1, PARTIAL: 0, FAILED: 0, SKIPPED_LOCKED: 0, SKIPPED_RECENT: 0, SKIPPED_BUDGET: 0, INELIGIBLE: 0 } }

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/cron/sync", { headers })
}

function deps(calls: { trigger: string; now: Date }[] = [], envOverride: Record<string, string | undefined> = env) {
  return { calls, deps: { env: envOverride, run: async (trigger: "cron" | "manual" | "test", now: Date) => { calls.push({ trigger, now }); return summary }, now: () => new Date("2026-09-17T03:00:00Z") } }
}

describe("authorizeCronRequest", () => {
  it("rejects a missing header", () => {
    assert.deepEqual(authorizeCronRequest(request(), env), { ok: false, status: 401, reason: "Unauthorized." })
  })
  it("rejects a wrong secret, a wrong scheme, and a prefix of the secret", () => {
    assert.equal(authorizeCronRequest(request({ authorization: "Bearer nope-nope-nope-nope" }), env).ok, false)
    assert.equal(authorizeCronRequest(request({ authorization: SECRET }), env).ok, false)
    assert.equal(authorizeCronRequest(request({ authorization: `Bearer ${SECRET.slice(0, -1)}` }), env).ok, false)
    assert.equal(authorizeCronRequest(request({ authorization: `Basic ${SECRET}` }), env).ok, false)
  })
  it("accepts the documented Bearer header, case-insensitively on the scheme", () => {
    assert.deepEqual(authorizeCronRequest(request({ authorization: `Bearer ${SECRET}` }), env), { ok: true })
    assert.deepEqual(authorizeCronRequest(request({ authorization: `bearer ${SECRET}` }), env), { ok: true })
  })
  it("refuses to run at all when no (or a too-short) secret is configured", () => {
    const status = (auth: ReturnType<typeof authorizeCronRequest>) => (auth.ok ? 200 : auth.status)
    assert.equal(status(authorizeCronRequest(request({ authorization: "Bearer " }), {})), 503)
    assert.equal(status(authorizeCronRequest(request({ authorization: "Bearer short" }), { CRON_SECRET: "short" })), 503)
  })
})

describe("handleCronSync", () => {
  it("401 without valid auth and the scheduler is never invoked", async () => {
    const d = deps()
    const res = await handleCronSync(request(), d.deps)
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { ok: false, error: "Unauthorized." })
    assert.equal(d.calls.length, 0)
    const bad = await handleCronSync(request({ authorization: "Bearer wrong-wrong-wrong-wrong" }), d.deps)
    assert.equal(bad.status, 401)
    assert.equal(d.calls.length, 0)
  })

  it("503 when the secret is not configured, without invoking the scheduler", async () => {
    const d = deps([], {})
    const res = await handleCronSync(request({ authorization: `Bearer ${SECRET}` }), d.deps)
    assert.equal(res.status, 503)
    assert.equal(d.calls.length, 0)
  })

  it("valid auth invokes the scheduler exactly once and returns its summary", async () => {
    const d = deps()
    const res = await handleCronSync(request({ authorization: `Bearer ${SECRET}`, "user-agent": "vercel-cron/1.0" }), d.deps)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get("cache-control"), "no-store")
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.trigger, "cron")
    assert.deepEqual(body.sources, summary.sources)
    assert.deepEqual(body.counts, summary.counts)
    assert.equal(d.calls.length, 1)
    assert.equal(d.calls[0].trigger, "cron")
    assert.equal(d.calls[0].now.toISOString(), "2026-09-17T03:00:00.000Z")
  })

  it("a non-Vercel caller with the secret is a manual trigger", async () => {
    const d = deps()
    await handleCronSync(request({ authorization: `Bearer ${SECRET}`, "user-agent": "curl/8.0" }), d.deps)
    assert.equal(d.calls[0].trigger, "manual")
  })

  it("never echoes the secret in any response", async () => {
    const d = deps()
    for (const headers of [{}, { authorization: `Bearer ${SECRET}` }, { authorization: "Bearer wrong-wrong-wrong-wrong" }] as Record<string, string>[]) {
      const res = await handleCronSync(request(headers), d.deps)
      const text = await res.text()
      assert.ok(!text.includes(SECRET), "secret must not appear in the body")
    }
  })

  it("an unexpected scheduler crash is a 500 with a safe message", async () => {
    const d = deps()
    const res = await handleCronSync(request({ authorization: `Bearer ${SECRET}` }), { ...d.deps, run: async () => { throw new Error(`db down at postgres://user:${SECRET}@host`) } })
    assert.equal(res.status, 500)
    const text = await res.text()
    assert.ok(!text.includes(SECRET))
    assert.match(text, /unexpectedly/)
  })
})
