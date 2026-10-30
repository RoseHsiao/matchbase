import assert from "node:assert/strict"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"

import { createMailer } from "../../lib/mail/create-mailer"
import { readMailEnv } from "../../lib/mail/mail-env"
import { describeMailResult, invalidMessageReason, type MailMessage, type MailResult } from "../../lib/mail/mailer"
import { withRecipientPolicy } from "../../lib/mail/recipient-policy"
import { createCaptureMailer } from "../../lib/mail/transports/capture"
import { createDevOutboxMailer } from "../../lib/mail/transports/dev-outbox"
import { createDisabledMailer } from "../../lib/mail/transports/disabled"
import { buildResendRequest, createResendMailer, RESEND_ENDPOINT } from "../../lib/mail/transports/resend"

/**
 * Every transport, without a network: Resend gets a stub `fetch` that
 * records the request and answers what the case needs. A guard stub fails
 * the test if anything ever reaches the real global fetch.
 */

const KEY = "re_TestKey_0123456789abcdef"
const SECRET_LINK = "https://matchbase.example/reset-password#token=SuperSecretToken123456"

const message: MailMessage = {
  kind: "password-reset",
  to: "person@example.com",
  subject: "Reset your MatchBase password",
  text: `Open ${SECRET_LINK} within 30 minutes.`,
  html: `<p><a href="${SECRET_LINK}">Reset</a></p>`,
}

const realFetch = globalThis.fetch
globalThis.fetch = (() => {
  throw new Error("A test tried to reach the real network.")
}) as typeof fetch
after(() => {
  globalThis.fetch = realFetch
})

type Recorded = { url: string; init: RequestInit }

function stubFetch(answer: (recorded: Recorded) => Response | Promise<Response>): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    const recorded = { url: String(url), init: init ?? {} }
    calls.push(recorded)
    return answer(recorded)
  }) as typeof fetch
  return { fetch: fetchStub, calls }
}

/** Every string a result could put in a log. */
function serialized(result: MailResult): string {
  return `${JSON.stringify(result)} ${describeMailResult(message.kind, result)}`
}

function assertNothingSensitive(text: string): void {
  for (const needle of [message.to, "SuperSecretToken123456", KEY, message.subject, "leaked-provider-detail"]) {
    assert.ok(!text.includes(needle), `must not contain ${needle}: ${text}`)
  }
}

describe("Resend transport: request shape", () => {
  it("POSTs one recipient as JSON with the key only in the Authorization header", async () => {
    const stub = stubFetch(() => Response.json({ id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" }))
    const mailer = createResendMailer({ apiKey: KEY, from: "MatchBase <noreply@mail.example.com>", replyTo: "support@example.com", fetch: stub.fetch })
    const result = await mailer.send({ ...message, idempotencyKey: "reminder:match-1:user-1" })

    assert.deepEqual(result, { status: "sent", transport: "resend", providerMessageId: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" })
    assert.equal(stub.calls.length, 1)
    const [{ url, init }] = stub.calls
    assert.equal(url, RESEND_ENDPOINT)
    assert.equal(init.method, "POST")
    const headers = init.headers as Record<string, string>
    assert.equal(headers.authorization, `Bearer ${KEY}`)
    assert.equal(headers["content-type"], "application/json")
    assert.equal(headers["idempotency-key"], "reminder:match-1:user-1")
    assert.match(headers["user-agent"], /^MatchBase\//, "an explicit User-Agent (Resend answers 403/1010 without one)")
    assert.ok(init.signal instanceof AbortSignal, "every request carries a timeout signal")
    const body = JSON.parse(String(init.body))
    assert.deepEqual(body, {
      from: "MatchBase <noreply@mail.example.com>",
      to: ["person@example.com"],
      subject: message.subject,
      text: message.text,
      html: message.html,
      reply_to: "support@example.com",
      tags: [{ name: "kind", value: "password-reset" }],
    })
    assert.ok(!String(init.body).includes(KEY), "the key is never in the payload")
  })

  it("omits optional fields that are not set", () => {
    const { body, init } = buildResendRequest({ kind: "test", to: "a@example.com", subject: "s", text: "t" }, { apiKey: KEY, from: "a@example.com" })
    assert.deepEqual(Object.keys(body).sort(), ["from", "subject", "tags", "text", "to"])
    assert.equal((init.headers as Record<string, string>)["idempotency-key"], undefined)
  })

  it("refuses a malformed message before any request", async () => {
    const stub = stubFetch(() => Response.json({ id: "x" }))
    const mailer = createResendMailer({ apiKey: KEY, from: "a@example.com", fetch: stub.fetch })
    for (const bad of [
      { ...message, to: "a@example.com, b@example.com" },
      { ...message, to: "a@example.com\r\nBcc: c@example.com" },
      { ...message, subject: "Hello\r\nBcc: c@example.com" },
      { ...message, subject: "" },
      { ...message, text: "  " },
      { ...message, kind: "Password Reset" },
      { ...message, idempotencyKey: "has space" },
    ]) {
      assert.deepEqual(await mailer.send(bad), { status: "failed", transport: "resend", category: "invalid-message", retryable: false })
    }
    assert.equal(stub.calls.length, 0)
  })

  it("refuses to be constructed without a key", () => {
    assert.throws(() => createResendMailer({ apiKey: " ", from: "a@example.com" }))
  })
})

describe("Resend transport: failures are categorised, never thrown, and leak nothing", () => {
  const providerBody = JSON.stringify({ statusCode: 0, name: "error", message: `leaked-provider-detail for ${message.to} ${KEY}` })

  for (const [status, category, retryable] of [
    [401, "auth-config", false],
    [403, "auth-config", false],
    [429, "rate-limit", true],
    [400, "provider-4xx", false],
    [422, "provider-4xx", false],
    [500, "provider-5xx", true],
    [503, "provider-5xx", true],
  ] as const) {
    it(`HTTP ${status} → ${category}`, async () => {
      let bodyRead = false
      const stub = stubFetch(() => {
        const stream = new ReadableStream({
          pull(controller) {
            bodyRead = true
            controller.enqueue(new TextEncoder().encode(providerBody))
            controller.close()
          },
        }, { highWaterMark: 0 })
        return new Response(stream, { status, headers: { "content-type": "application/json" } })
      })
      const result = await createResendMailer({ apiKey: KEY, from: "a@example.com", fetch: stub.fetch }).send(message)
      assert.deepEqual(result, { status: "failed", transport: "resend", category, retryable, httpStatus: status })
      assert.equal(bodyRead, false, "a failed response body is discarded unread")
      assertNothingSensitive(serialized(result))
    })
  }

  it("HTTP 409 is read only for Resend's error name: in progress retries, a payload conflict is not a failure", async () => {
    const cases: [unknown, string, boolean][] = [
      [{ statusCode: 409, name: "concurrent_idempotent_requests", message: `leaked-provider-detail ${message.to}` }, "in-progress", true],
      [{ statusCode: 409, name: "resource_locked", message: "leaked-provider-detail" }, "in-progress", true],
      [{ statusCode: 409, name: "invalid_idempotent_request", message: `leaked-provider-detail ${message.to}` }, "idempotency-conflict", false],
      [{ statusCode: 409, name: "something_new", message: "leaked-provider-detail" }, "in-progress", true],
      ["not json at all leaked-provider-detail", "in-progress", true],
    ]
    for (const [body, category, retryable] of cases) {
      const stub = stubFetch(() => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 409 }))
      const result = await createResendMailer({ apiKey: KEY, from: "a@example.com", fetch: stub.fetch }).send({ ...message, idempotencyKey: "notification:abc" })
      assert.deepEqual(result, { status: "failed", transport: "resend", category, retryable, httpStatus: 409 }, JSON.stringify(body))
      assertNothingSensitive(serialized(result))
    }
  })

  it("a request that exceeds the timeout → timeout", async () => {
    const stub = stubFetch(
      ({ init }) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason))
        })
    )
    const started = Date.now()
    const result = await createResendMailer({ apiKey: KEY, from: "a@example.com", fetch: stub.fetch, timeoutMs: 30 }).send(message)
    assert.deepEqual(result, { status: "failed", transport: "resend", category: "timeout", retryable: true })
    assert.ok(Date.now() - started < 2_000, "bounded")
  })

  it("a connection failure → network, without the error text", async () => {
    const stub = stubFetch(() => {
      throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND api.resend.com for ${message.to}`)
    })
    const result = await createResendMailer({ apiKey: KEY, from: "a@example.com", fetch: stub.fetch }).send(message)
    assert.deepEqual(result, { status: "failed", transport: "resend", category: "network", retryable: true })
    assertNothingSensitive(serialized(result))
  })

  it("a 2xx with an unexpected body is still sent, and only a well-formed id is kept", async () => {
    for (const body of ["not json", JSON.stringify({ id: `leaked-provider-detail ${message.to}` }), JSON.stringify({})]) {
      const stub = stubFetch(() => new Response(body, { status: 200 }))
      const result = await createResendMailer({ apiKey: KEY, from: "a@example.com", fetch: stub.fetch }).send(message)
      assert.deepEqual(result, { status: "sent", transport: "resend", providerMessageId: undefined })
    }
  })

  it("the log line names only kind, transport, outcome and category", () => {
    const line = describeMailResult("password-reset", { status: "failed", transport: "resend", category: "rate-limit", retryable: true, httpStatus: 429 })
    assert.equal(line, "[mail] kind=password-reset transport=resend status=failed category=rate-limit retryable=true http=429")
  })
})

describe("Preview recipient policy", () => {
  it("delivers to allowlisted recipients and suppresses everyone else without echoing the address", async () => {
    const capture = createCaptureMailer({})
    const config = readMailEnv({ VERCEL_ENV: "preview", MAIL_TRANSPORT: "resend", MAIL_FROM: "a@example.com", RESEND_API_KEY: KEY, MAIL_ALLOWED_RECIPIENTS: "Tester@Example.com" })
    assert.equal(config.transport.kind, "resend")
    const policy = config.transport.kind === "resend" ? config.transport.recipients : { mode: "all" as const }
    const mailer = withRecipientPolicy(capture, policy)

    assert.equal((await mailer.send({ ...message, to: "tester@example.com" })).status, "sent")
    const suppressed = await mailer.send(message)
    assert.deepEqual(suppressed, { status: "suppressed", transport: "capture", reason: "recipient-not-allowlisted" })
    assertNothingSensitive(serialized(suppressed))
    assert.deepEqual(capture.messages.map((m) => m.to), ["tester@example.com"])
  })

  it("createMailer wires the allowlist in front of Resend, so a suppressed recipient never reaches fetch", async () => {
    const stub = stubFetch(() => Response.json({ id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" }))
    const config = readMailEnv({ VERCEL_ENV: "preview", MAIL_TRANSPORT: "resend", MAIL_FROM: "a@example.com", RESEND_API_KEY: KEY, MAIL_ALLOWED_RECIPIENTS: "tester@example.com" })
    const mailer = createMailer(config, { fetch: stub.fetch })
    assert.equal((await mailer.send(message)).status, "suppressed")
    assert.equal(stub.calls.length, 0)
    assert.equal((await mailer.send({ ...message, to: "tester@example.com" })).status, "sent")
    assert.equal(stub.calls.length, 1)
  })
})

describe("disabled transport", () => {
  it("answers disabled, never sent", async () => {
    const result = await createDisabledMailer("Mail is off here.").send(message)
    assert.deepEqual(result, { status: "disabled", transport: "disabled", reason: "Mail is off here." })
  })

  it("is what createMailer returns for an unconfigured or refused environment", async () => {
    for (const env of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "production", MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "a@example.com" }, { VERCEL_ENV: "preview", MAIL_TRANSPORT: "resend", MAIL_FROM: "a@example.com", RESEND_API_KEY: KEY }]) {
      const mailer = createMailer(readMailEnv(env))
      assert.equal(mailer.transport, "disabled")
      assert.equal((await mailer.send(message)).status, "disabled")
    }
  })
})

describe("capture transport", () => {
  it("records sent messages as copies and can be told to fail", async () => {
    const capture = createCaptureMailer({})
    const original = { ...message }
    assert.deepEqual(await capture.send(original), { status: "sent", transport: "capture" })
    original.text = "changed afterwards"
    assert.equal(capture.messages[0].text, message.text)
    assert.ok(capture.messages[0].text.includes("SuperSecretToken123456"), "tests can read the link")

    capture.respondWith({ status: "failed", transport: "capture", category: "provider-5xx", retryable: true })
    assert.equal((await capture.send(message)).status, "failed")
    assert.equal(capture.messages.length, 1, "failed sends are not recorded")
    capture.clear()
    assert.equal(capture.messages.length, 0)
  })

  it("validates messages like every other transport", async () => {
    assert.equal((await createCaptureMailer({}).send({ ...message, to: "nope" })).status, "failed")
  })

  it("cannot be constructed in production", () => {
    assert.throws(() => createCaptureMailer({ VERCEL_ENV: "production" }), /tests/)
    assert.throws(() => createCaptureMailer({ NODE_ENV: "production" }), /tests/)
  })
})

describe("development outbox", () => {
  const dirs: string[] = []
  after(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  })

  it("writes the message to a file and logs only the kind and file name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "matchbase-outbox-"))
    dirs.push(dir)
    const lines: string[] = []
    const mailer = createDevOutboxMailer({ from: "dev@example.com", env: { NODE_ENV: "development" }, dir, log: (line) => lines.push(line) })
    const result = await mailer.send(message)
    assert.equal(result.status, "sent")

    const files = (await readdir(dir)).sort()
    assert.equal(files.length, 2)
    const json = JSON.parse(await readFile(path.join(dir, files.find((f) => f.endsWith(".json"))!), "utf8"))
    assert.equal(json.to, message.to)
    assert.equal(json.text, message.text)
    assert.equal(lines.length, 1)
    assert.match(lines[0], /^\[mail\] dev-outbox kind=password-reset written to /)
    assertNothingSensitive(lines[0])
  })

  it("refuses to initialise outside development", () => {
    for (const env of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "production" }, { NODE_ENV: "production" }, { VERCEL_ENV: "production", NODE_ENV: "development" }]) {
      assert.throws(() => createDevOutboxMailer({ from: "dev@example.com", env }), /refused/)
    }
  })

  it("createMailer selects it only from a development configuration", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "matchbase-outbox-"))
    dirs.push(dir)
    const mailer = createMailer(readMailEnv({ NODE_ENV: "development", MAIL_TRANSPORT: "dev-outbox", MAIL_FROM: "dev@example.com" }), { env: { NODE_ENV: "development" }, devOutboxDir: dir })
    assert.equal(mailer.transport, "dev-outbox")
  })
})

describe("message validation", () => {
  it("accepts a well-formed message", () => {
    assert.equal(invalidMessageReason(message), null)
  })
})
