/**
 * Small, dependency-free HTTP helpers for provider adapters: timeouts,
 * bounded retries with backoff, a minimum interval between requests, and
 * error classification the sync service can report without leaking anything.
 * Adapters compose these; the sync service never makes requests itself.
 *
 * Retry policy (deliberately narrow, see docs/live-data-integration.md):
 * - retried: 429, 502, 503, 504, request timeouts, connection failures
 * - never retried: 400-level errors (401/403 are credentials, 404 is the
 *   wrong path, 400 is a bad request we built), 500/501, malformed bodies
 *
 * Both the transport (`fetch`) and the clock (`sleep`) are injectable so
 * every path is testable without a network or real waiting.
 */

/** Serialises calls so that at least `minIntervalMs` separates them. */
export class RateLimiter {
  private nextAllowedAt = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly minIntervalMs: number,
    private readonly wait_: (ms: number) => Promise<void> = (ms) => sleep(ms)
  ) {}

  /** Resolves when the caller may make its next request. */
  wait(): Promise<void> {
    const turn = this.queue.then(async () => {
      const delay = this.nextAllowedAt - Date.now()
      if (delay > 0) await this.wait_(delay)
      this.nextAllowedAt = Date.now() + this.minIntervalMs
    })
    this.queue = turn.catch(() => undefined)
    return turn
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function abortError(): Error {
  const error = new Error("Request aborted.")
  error.name = "AbortError"
  return error
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * How a failure should be reported and whether it is worth retrying.
 * `auth` and `configuration` are the caller's problem; `rate-limit`, `server`,
 * `timeout` and `network` are transient; `client` and `malformed` mean the
 * request or the response is wrong and repeating it will not help.
 */
export type HttpErrorKind = "auth" | "rate-limit" | "server" | "client" | "timeout" | "network" | "malformed"

export class HttpError extends Error {
  readonly kind: HttpErrorKind

  constructor(
    public readonly status: number,
    public readonly url: string,
    /** From a Retry-After header, when the server sent one. */
    public readonly retryAfterMs?: number
  ) {
    super(`HTTP ${status} from ${redactUrl(url)}`)
    this.name = "HttpError"
    this.kind = status === 401 || status === 403 ? "auth" : status === 429 ? "rate-limit" : status >= 500 ? "server" : "client"
  }
}

/** The server answered 2xx but the body was not the JSON we expected. */
export class MalformedResponseError extends Error {
  readonly kind = "malformed" as const
  constructor(
    public readonly url: string,
    detail: string
  ) {
    super(`Malformed response from ${redactUrl(url)}: ${detail}`)
    this.name = "MalformedResponseError"
  }
}

const SECRET_QUERY_KEYS = /^(api[_-]?key|apikey|key|token|access[_-]?token|secret)$/i

/**
 * Strips credential-looking query parameters from a URL before it is put in
 * an error message or a sync log. Header-based keys never reach a URL, but
 * some providers take the key as a query parameter; those must not be logged.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.test(key)) parsed.searchParams.set(key, "REDACTED")
    }
    return parsed.toString()
  } catch {
    return url.replace(/([?&](?:api[_-]?key|apikey|key|token|access[_-]?token|secret)=)[^&#]*/gi, "$1REDACTED")
  }
}

/** Replaces every occurrence of the given secrets in a message. */
export function redactSecrets(message: string, secrets: readonly (string | undefined)[]): string {
  let out = message
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("REDACTED")
  }
  return out
}

/** Which kind of failure an arbitrary thrown value represents. */
export function classifyError(error: unknown): HttpErrorKind | "unknown" {
  if (error instanceof HttpError) return error.kind
  if (error instanceof MalformedResponseError) return "malformed"
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "timeout"
    if (error.name === "AbortError") return "timeout"
    if (/fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(error.message)) return "network"
  }
  return "unknown"
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

/** Rate limits, gateway errors, timeouts and connection failures are worth retrying; nothing else is. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return RETRYABLE_STATUSES.has(error.status)
  const kind = classifyError(error)
  return kind === "timeout" || kind === "network"
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

export type RetryOptions = {
  /** Attempts after the first one. */
  retries?: number
  /** Base delay; doubles on every retry. */
  delayMs?: number
  /** Upper bound for any single wait, including one requested by Retry-After. */
  maxDelayMs?: number
  /** Return false to stop retrying for this error. */
  shouldRetry?: (error: unknown, attempt: number) => boolean
  signal?: AbortSignal
  /** Injectable wait, for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** Runs `work` with bounded exponential-backoff retries. */
export async function withRetry<T>(work: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2
  const delayMs = options.delayMs ?? 500
  const maxDelayMs = options.maxDelayMs ?? 30_000
  const wait = options.sleep ?? sleep
  let attempt = 0
  for (;;) {
    try {
      return await work(attempt)
    } catch (error) {
      const retryable = options.shouldRetry ? options.shouldRetry(error, attempt) : isRetryable(error)
      if (attempt >= retries || !retryable || options.signal?.aborted) throw error
      const requested = error instanceof HttpError && error.retryAfterMs !== undefined ? error.retryAfterMs : delayMs * 2 ** attempt
      await wait(Math.min(requested, maxDelayMs), options.signal)
      attempt++
    }
  }
}

// ---------------------------------------------------------------------------
// fetchJson
// ---------------------------------------------------------------------------

/** Retry-After is either delay-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const at = Date.parse(trimmed)
  return Number.isNaN(at) ? undefined : Math.max(0, at - now)
}

export type FetchJsonOptions = RetryOptions & {
  timeoutMs?: number
  headers?: Record<string, string>
  limiter?: RateLimiter
  /** Called with the successful response's headers, e.g. to read pagination totals. */
  onResponse?: (headers: Headers) => void
  /** Injectable transport, for tests. */
  fetch?: typeof fetch
}

/** GET a JSON document with a timeout, bounded retries, and optional rate limiting. */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const transport = options.fetch ?? fetch
  return withRetry(async () => {
    if (options.limiter) await options.limiter.wait()
    const signals = [AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]
    const response = await transport(url, { headers: options.headers, signal: AbortSignal.any(signals) })
    if (!response.ok) {
      throw new HttpError(response.status, url, parseRetryAfter(response.headers.get("retry-after")))
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw new MalformedResponseError(url, error instanceof Error ? error.message : "invalid JSON")
    }
    if (body === null || typeof body !== "object") throw new MalformedResponseError(url, "expected a JSON object")
    options.onResponse?.(response.headers)
    return body as T
  }, options)
}
