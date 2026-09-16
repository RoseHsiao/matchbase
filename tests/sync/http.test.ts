import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  classifyError,
  fetchJson,
  HttpError,
  isRetryable,
  MalformedResponseError,
  parseRetryAfter,
  RateLimiter,
  redactSecrets,
  redactUrl,
  withRetry,
} from "../../lib/data/sync/utils/http"

/** A scripted transport: each call pops the next response (or throws the next error). */
function scripted(steps: (Response | Error)[]) {
  const calls: string[] = []
  const transport: typeof fetch = async (input) => {
    calls.push(String(input))
    const step = steps.shift()
    if (!step) throw new Error("no more scripted responses")
    if (step instanceof Error) throw step
    return step
  }
  return { transport, calls }
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init })
const status = (code: number, headers: Record<string, string> = {}) => new Response("", { status: code, headers })

/** Records requested waits instead of sleeping. */
function fakeSleep() {
  const waits: number[] = []
  return { waits, sleep: async (ms: number) => { waits.push(ms) } }
}

const URL = "https://api.example.test/tennis/trial/v3/en/competitions.json"

describe("fetchJson", () => {
  it("returns the parsed body and exposes headers", async () => {
    const { transport } = scripted([json({ ok: true }, { headers: { "x-max-results": "7" } })])
    let seen = ""
    const body = await fetchJson<{ ok: boolean }>(URL, { fetch: transport, onResponse: (h) => { seen = h.get("x-max-results") ?? "" } })
    assert.deepEqual(body, { ok: true })
    assert.equal(seen, "7")
  })

  it("does not retry 401 or 403 (credentials are not transient)", async () => {
    for (const code of [401, 403]) {
      const { transport, calls } = scripted([status(code), json({})])
      const { sleep } = fakeSleep()
      await assert.rejects(fetchJson(URL, { fetch: transport, sleep, retries: 3 }), (e: unknown) => e instanceof HttpError && e.status === code && e.kind === "auth")
      assert.equal(calls.length, 1, `HTTP ${code} must be requested once`)
    }
  })

  it("does not retry 400 or 404 (our request is wrong) nor 500 (not classified transient)", async () => {
    for (const code of [400, 404, 500]) {
      const { transport, calls } = scripted([status(code), json({})])
      await assert.rejects(fetchJson(URL, { fetch: transport, sleep: fakeSleep().sleep, retries: 3 }), (e: unknown) => e instanceof HttpError && e.status === code)
      assert.equal(calls.length, 1, `HTTP ${code} must be requested once`)
    }
  })

  it("retries 429 and honours Retry-After in seconds", async () => {
    const { transport, calls } = scripted([status(429, { "retry-after": "2" }), json({ done: true })])
    const { waits, sleep } = fakeSleep()
    const body = await fetchJson(URL, { fetch: transport, sleep, retries: 3 })
    assert.deepEqual(body, { done: true })
    assert.equal(calls.length, 2)
    assert.deepEqual(waits, [2000])
  })

  it("honours an HTTP-date Retry-After and caps the wait", async () => {
    const future = new Date(Date.now() + 120_000).toUTCString()
    const { transport } = scripted([status(429, { "retry-after": future }), json({})])
    const { waits, sleep } = fakeSleep()
    await fetchJson(URL, { fetch: transport, sleep, retries: 1, maxDelayMs: 5000 })
    assert.equal(waits.length, 1)
    assert.equal(waits[0], 5000)
  })

  it("retries 502, 503 and 504 with exponential backoff, then gives up", async () => {
    const { transport, calls } = scripted([status(502), status(503), status(504), status(503)])
    const { waits, sleep } = fakeSleep()
    await assert.rejects(fetchJson(URL, { fetch: transport, sleep, retries: 3, delayMs: 100 }), (e: unknown) => e instanceof HttpError && e.status === 503 && e.kind === "server")
    assert.equal(calls.length, 4, "first attempt plus three retries")
    assert.deepEqual(waits, [100, 200, 400])
  })

  it("retries a timeout and a connection failure", async () => {
    const timeout = new Error("The operation was aborted due to timeout")
    timeout.name = "TimeoutError"
    const network = new TypeError("fetch failed")
    const { transport, calls } = scripted([timeout, network, json({ ok: 1 })])
    const body = await fetchJson(URL, { fetch: transport, sleep: fakeSleep().sleep, retries: 2 })
    assert.deepEqual(body, { ok: 1 })
    assert.equal(calls.length, 3)
  })

  it("reports a non-JSON 200 body as malformed and does not retry it", async () => {
    const { transport, calls } = scripted([new Response("<html>oops</html>", { status: 200 }), json({})])
    await assert.rejects(fetchJson(URL, { fetch: transport, sleep: fakeSleep().sleep, retries: 2 }), (e: unknown) => e instanceof MalformedResponseError && e.kind === "malformed")
    assert.equal(calls.length, 1)
  })

  it("reports a JSON scalar body as malformed", async () => {
    const { transport } = scripted([json("just a string")])
    await assert.rejects(fetchJson(URL, { fetch: transport, sleep: fakeSleep().sleep }), /expected a JSON object/)
  })

  it("waits for the rate limiter between requests", async () => {
    const gaps: number[] = []
    const limiter = new RateLimiter(50, async (ms) => { gaps.push(ms) })
    const { transport } = scripted([json({}), json({})])
    await fetchJson(URL, { fetch: transport, limiter })
    await fetchJson(URL, { fetch: transport, limiter })
    assert.equal(gaps.length, 1)
    assert.ok(gaps[0] > 0 && gaps[0] <= 50)
  })
})

describe("withRetry", () => {
  it("stops when shouldRetry says so and never exceeds the retry budget", async () => {
    let attempts = 0
    await assert.rejects(
      withRetry(async () => { attempts++; throw new Error("boom") }, { retries: 5, sleep: fakeSleep().sleep, shouldRetry: (_e, attempt) => attempt < 1 }),
      /boom/
    )
    assert.equal(attempts, 2)
  })

  it("stops retrying once the signal is aborted", async () => {
    const controller = new AbortController()
    let attempts = 0
    await assert.rejects(
      withRetry(async () => { attempts++; controller.abort(); throw new HttpError(503, URL) }, { retries: 5, sleep: fakeSleep().sleep, signal: controller.signal }),
      (e: unknown) => e instanceof HttpError
    )
    assert.equal(attempts, 1)
  })
})

describe("classification and redaction", () => {
  it("classifies statuses", () => {
    assert.equal(new HttpError(401, URL).kind, "auth")
    assert.equal(new HttpError(429, URL).kind, "rate-limit")
    assert.equal(new HttpError(503, URL).kind, "server")
    assert.equal(new HttpError(404, URL).kind, "client")
    assert.equal(classifyError(new MalformedResponseError(URL, "x")), "malformed")
    assert.equal(classifyError(Object.assign(new Error("t"), { name: "TimeoutError" })), "timeout")
    assert.equal(classifyError(new TypeError("fetch failed")), "network")
    assert.equal(classifyError(new Error("something else")), "unknown")
  })

  it("only retries the transient kinds", () => {
    assert.equal(isRetryable(new HttpError(429, URL)), true)
    assert.equal(isRetryable(new HttpError(503, URL)), true)
    assert.equal(isRetryable(new HttpError(500, URL)), false)
    assert.equal(isRetryable(new HttpError(401, URL)), false)
    assert.equal(isRetryable(new MalformedResponseError(URL, "x")), false)
    assert.equal(isRetryable(new TypeError("fetch failed")), true)
  })

  it("parses Retry-After", () => {
    assert.equal(parseRetryAfter("3"), 3000)
    assert.equal(parseRetryAfter(" 10 "), 10_000)
    assert.equal(parseRetryAfter("garbage"), undefined)
    assert.equal(parseRetryAfter(null), undefined)
    const now = Date.parse("2026-09-16T00:00:00Z")
    assert.equal(parseRetryAfter("Wed, 16 Sep 2026 00:00:30 GMT", now), 30_000)
    assert.equal(parseRetryAfter("Tue, 15 Sep 2026 00:00:00 GMT", now), 0)
  })

  it("scrubs key-like query parameters from URLs in error messages", () => {
    const error = new HttpError(500, "https://api.example.test/v1/x.json?api_key=SECRET123&start=0")
    assert.match(error.message, /api_key=REDACTED/)
    assert.doesNotMatch(error.message, /SECRET123/)
    assert.equal(redactUrl("https://h/p?token=abc&x=1"), "https://h/p?token=REDACTED&x=1")
    assert.equal(redactUrl("not a url?apikey=zzz"), "not a url?apikey=REDACTED")
  })

  it("redacts explicit secrets from arbitrary text", () => {
    assert.equal(redactSecrets("key SECRET123 leaked SECRET123", ["SECRET123", undefined]), "key REDACTED leaked REDACTED")
    assert.equal(redactSecrets("short ab", ["ab"]), "short ab", "very short values are not treated as secrets")
  })
})
