/**
 * Small, dependency-free HTTP helpers for provider adapters: timeouts,
 * bounded retries with backoff, and a minimum interval between requests.
 * Adapters compose these; the sync service never makes requests itself.
 */

/** Serialises calls so that at least `minIntervalMs` separates them. */
export class RateLimiter {
  private nextAllowedAt = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly minIntervalMs: number) {}

  /** Resolves when the caller may make its next request. */
  wait(): Promise<void> {
    const turn = this.queue.then(async () => {
      const delay = this.nextAllowedAt - Date.now()
      if (delay > 0) await sleep(delay)
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
  return new Error("Request aborted.")
}

export type RetryOptions = {
  /** Attempts after the first one. */
  retries?: number
  /** Base delay; doubles on every retry. */
  delayMs?: number
  /** Return false to stop retrying for this error. */
  shouldRetry?: (error: unknown, attempt: number) => boolean
  signal?: AbortSignal
}

/** Runs `work` with bounded exponential-backoff retries. */
export async function withRetry<T>(work: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2
  const delayMs = options.delayMs ?? 500
  let attempt = 0
  for (;;) {
    try {
      return await work(attempt)
    } catch (error) {
      const retryable = options.shouldRetry ? options.shouldRetry(error, attempt) : isRetryable(error)
      if (attempt >= retries || !retryable || options.signal?.aborted) throw error
      const wait = error instanceof HttpError && error.retryAfterMs !== undefined ? error.retryAfterMs : delayMs * 2 ** attempt
      await sleep(wait, options.signal)
      attempt++
    }
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    /** From a Retry-After header, when the server sent one. */
    public readonly retryAfterMs?: number
  ) {
    super(`HTTP ${status} from ${url}`)
  }
}

/** Network failures, timeouts, 429 and 5xx are worth retrying; other 4xx are not. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 429 || error.status >= 500
  if (error instanceof Error) return error.name === "TimeoutError" || error.name === "AbortError" || /fetch failed|ECONNRESET|ETIMEDOUT/.test(error.message)
  return false
}

export type FetchJsonOptions = RetryOptions & {
  timeoutMs?: number
  headers?: Record<string, string>
  limiter?: RateLimiter
  /** Called with the successful response's headers, e.g. to read pagination totals. */
  onResponse?: (headers: Headers) => void
}

/** GET a JSON document with a timeout, bounded retries, and optional rate limiting. */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000
  return withRetry(async () => {
    if (options.limiter) await options.limiter.wait()
    const signals = [AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]
    const response = await fetch(url, { headers: options.headers, signal: AbortSignal.any(signals) })
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after")
      const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined
      throw new HttpError(response.status, url, retryAfterMs)
    }
    options.onResponse?.(response.headers)
    return (await response.json()) as T
  }, options)
}
