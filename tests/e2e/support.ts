import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"

/**
 * Shared by the end-to-end suites. They need a running local server and skip
 * without one; see docs/public-demo.md for the commands. They refuse any host
 * but localhost and any environment labelled production, because they sign in
 * and exercise real requests.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file)
}

export const BASE = process.env.MATCHBASE_E2E_BASE_URL
/** Set when the server was started with an unreachable DATABASE_URL. */
export const DATABASE_DOWN = process.env.MATCHBASE_E2E_DATABASE === "unreachable"
/**
 * Set to `open` when the server was started with public sign-up open (in
 * development: AUTH_ALLOW_SIGN_UP unset or true). Anything else means the
 * server was started with AUTH_ALLOW_SIGN_UP=false, the launch default.
 */
export const SIGN_UP_OPEN = process.env.MATCHBASE_E2E_SIGN_UP === "open"

/** A per-run marker for accounts a suite creates, so cleanup touches nothing else. */
export function e2eStamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Deletes exactly the accounts this run created: addresses that start with
 * `prefix` and end with `-<stamp>@example.test` (sessions, credentials and
 * personal rows cascade). Refuses unless the local configuration labels the
 * database `development`, and never touches any other row.
 */
export async function deleteStampedAccounts(prefix: string, stamp: string): Promise<number> {
  assert.equal(process.env.MATCHBASE_DATABASE_LABEL?.trim().toLowerCase(), "development", "cleanup runs only against the development database")
  assert.match(prefix, /^e2e-[a-z-]+$/)
  assert.match(stamp, /^\d{13}-[a-z0-9]{1,6}$/)
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  assert.ok(connectionString, "no development database URL")
  const [{ PrismaPg }, { PrismaClient }] = await Promise.all([import("@prisma/adapter-pg"), import("../../lib/generated/prisma/client")])
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  try {
    const { count } = await prisma.user.deleteMany({ where: { AND: [{ email: { startsWith: prefix } }, { email: { endsWith: `-${stamp}@example.test` } }] } })
    return count
  } finally {
    await prisma.$disconnect()
  }
}

export function assertLocalTarget(): void {
  assert.match(new URL(BASE ?? "").hostname, /^(localhost|127\.0\.0\.1)$/, "the end-to-end suites only run against a local server")
  assert.notEqual(process.env.MATCHBASE_DATABASE_LABEL?.trim().toLowerCase(), "production", "the end-to-end suites never run against Production")
}

export function url(path: string): string {
  return new URL(path, BASE).toString()
}

export const origin = (): string => new URL(BASE ?? "").origin

export type Account = { email: string; password: string }

/** The local development accounts (.env.local), never printed. Provision them once with the quick sign-in under `next dev`. */
export function devAccount(role: "USER" | "ADMIN"): Account | undefined {
  const email = process.env[`MATCHBASE_DEV_${role}_EMAIL`]
  const password = process.env[`MATCHBASE_DEV_${role}_PASSWORD`]
  return email && password ? { email, password } : undefined
}

export type Page = { status: number; location: string | null; html: string; headers: Headers }

export async function page(path: string, init: RequestInit = {}): Promise<Page> {
  const response = await fetch(url(path), { redirect: "manual", ...init })
  return { status: response.status, location: response.headers.get("location"), headers: response.headers, html: await response.text() }
}

/** Signs in over HTTP and returns a Cookie header for that one session. */
export async function signInCookie(account: Account): Promise<string> {
  const response = await fetch(url("/api/auth/sign-in/email"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: origin() },
    body: JSON.stringify(account),
  })
  assert.equal(response.status, 200, "sign-in failed; are the development accounts provisioned?")
  await response.text()
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ")
}

/**
 * A client-navigation (RSC) request as the router makes it. Next.js answers
 * with a redirect to the same path carrying `_rsc`, a hash of the router
 * headers, so this follows it and asserts it got a real payload: a test that
 * read a 400 or a redirect here would pass without proving anything.
 */
export async function rscPage(path: string, headers: Record<string, string> = {}): Promise<Page> {
  const request = { rsc: "1", ...headers }
  let target = path
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await page(target, { headers: request })
    const next = response.location && /[?&]_rsc/.test(response.location) ? response.location : null
    if (!next) {
      assert.match(response.headers.get("content-type") ?? "", /text\/x-component/, `${path} did not answer with an RSC payload (status ${response.status})`)
      return response
    }
    target = next
  }
  assert.fail(`${path} kept redirecting`)
}

/** A Server Action's id from the local build's manifest, so the admin actions can be called without any admin page. */
export function actionId(exportedName: string): string {
  const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName?: string }> }
  const found = Object.entries(manifest.node).find(([, action]) => action.exportedName === exportedName)
  assert.ok(found, `${exportedName} is not in the build's action manifest`)
  return found[0]
}
