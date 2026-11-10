import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"

import { actionId, assertLocalTarget, BASE, DATABASE_DOWN, deleteStampedAccounts, e2eStamp, origin, page, SIGN_UP_OPEN, url } from "./support"

/**
 * Public sign-up over HTTP against a running local server started with sign-up
 * open (MATCHBASE_E2E_SIGN_UP=open; docs/public-demo.md). Every account here
 * has an `e2e-signup-…-<stamp>@example.test` address and only those accounts
 * are deleted at the end, from the development database only.
 *
 * The local server runs as development, where the rate limiter is off; the
 * Production/Preview configuration (both flags, limiter on) is exercised in
 * tests/db/public-sign-up.test.ts.
 */

const describeOpen = BASE && SIGN_UP_OPEN && !DATABASE_DOWN ? describe : describe.skip
const DEMO_MARKER = /exploring the demo/
const DEMO_RECORDS = /Redbrook Rovers|Kestrel Bay|Glasswing One/
const PASSWORD = "e2e sign-up password 1"
const stamp = e2eStamp()
const email = (label: string) => `e2e-signup-${label}-${stamp}@example.test`

type Json = Record<string, unknown> & { user?: Record<string, unknown> | null; code?: string }

async function post(path: string, body: unknown, cookie = ""): Promise<{ status: number; json: Json | null; cookie: string }> {
  const response = await fetch(url(`/api/auth${path}`), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", origin: origin(), ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const set = response.headers.getSetCookie().map((value) => value.split(";")[0]).filter((value) => !/=$/.test(value)).join("; ")
  return { status: response.status, json: text ? (JSON.parse(text) as Json) : null, cookie: set }
}

async function session(cookie: string): Promise<Json | null> {
  const { html } = await page("/api/auth/get-session", { headers: { cookie } })
  return JSON.parse(html) as Json | null
}

function signUp(label: string, extra: Record<string, unknown> = {}) {
  return post("/sign-up/email", { name: `E2E ${label}`, email: email(label), password: PASSWORD, ...extra })
}

describeOpen("public sign-up (server started with sign-up open)", () => {
  before(assertLocalTarget)

  after(async () => {
    const removed = await deleteStampedAccounts("e2e-signup-", stamp)
    assert.ok(removed <= 2, `removed ${removed} stamped accounts`)
  })

  it("the landing page, the sign-in page and the sign-up page offer it, and the form says the address is not verified", async () => {
    const landing = await page("/")
    assert.match(landing.html, /href="\/sign-up"[^>]*>Create account</)
    assert.match(landing.html, /Explore Demo/)
    assert.match(landing.html, /href="\/sign-in"/)
    assert.doesNotMatch(landing.html, /limited to authorized users/)

    assert.match((await page("/sign-in")).html, /href="\/sign-up"[^>]*>Create one</)

    const form = await page("/sign-up")
    assert.equal(form.status, 200)
    assert.match(form.html, /Your email address is not verified\./)
    assert.match(form.html, /no self-service password reset/)

    const demo = await page("/matches/demo-match-1")
    assert.match(demo.html, DEMO_MARKER)
    assert.match(demo.html, /href="\/sign-up\?next=%2Fmatches"/)
  })

  let cookie = ""

  it("sign up signs the new account in at once, as a USER with an unverified address, whatever the payload claims", async () => {
    // On create Better Auth replaces a server-owned field (`role`, input: false) with its default and drops
    // core fields it never takes from input (emailVerified, id, createdAt).
    const smuggled = await signUp("alice", { role: "ADMIN", emailVerified: true, id: "e2e-chosen-id", createdAt: "2000-01-01T00:00:00.000Z" })
    assert.equal(smuggled.status, 200)
    assert.match(smuggled.cookie, /better-auth\.session_token=/)
    assert.equal(smuggled.json?.user?.emailVerified, false)
    assert.equal(smuggled.json?.user?.role, "USER")
    assert.notEqual(smuggled.json?.user?.id, "e2e-chosen-id")
    assert.notEqual(String(smuggled.json?.user?.createdAt).slice(0, 4), "2000")
    cookie = smuggled.cookie

    const current = await session(cookie)
    assert.equal(current?.user?.email, email("alice"))
    assert.equal(current?.user?.role, "USER")
    assert.equal(current?.user?.emailVerified, false)
  })

  it("the new account gets the real app: no demo, its own Watchlist, and Admin refused", async () => {
    const dashboard = await page("/dashboard", { headers: { cookie } })
    assert.equal(dashboard.status, 200)
    assert.doesNotMatch(dashboard.html, DEMO_MARKER)
    assert.ok(dashboard.html.includes(email("alice")))
    assert.doesNotMatch((await page("/teams", { headers: { cookie } })).html, DEMO_RECORDS, "the signed-in catalogue is the database, not the demo")
    assert.equal((await page("/watchlist", { headers: { cookie } })).status, 200)
    const adminPage = await page("/admin", { headers: { cookie } })
    assert.match(adminPage.html, /Administrators only/)
    assert.doesNotMatch(adminPage.html, /dataSources|syncLogs/)
    const adminAction = await fetch(url("/admin"), {
      method: "POST",
      headers: { "next-action": actionId("deleteAdminRecord"), "content-type": "text/plain;charset=UTF-8", origin: origin(), cookie },
      body: JSON.stringify(["teams", "e2e-probe-does-not-exist"]),
    })
    assert.match(await adminAction.text(), /"ok":false,"error":"Only administrators can make changes\."/)
  })

  it("the account cannot raise its own role or mark its address verified", async () => {
    const role = await post("/update-user", { role: "ADMIN" }, cookie)
    assert.equal(role.status, 400)
    assert.equal(role.json?.code, "FIELD_NOT_ALLOWED")
    const verified = await post("/update-user", { name: "E2E alice", emailVerified: true }, cookie)
    assert.equal(verified.status, 200, "the name changes; emailVerified is not an input field and is dropped")
    const address = await post("/update-user", { email: email("mallory") }, cookie)
    assert.equal(address.status, 400, "the address cannot be swapped without verification either")
    const current = await session(cookie)
    assert.equal(current?.user?.email, email("alice"))
    assert.equal(current?.user?.role, "USER")
    assert.equal(current?.user?.emailVerified, false)
  })

  it("one account's Watchlist is invisible to another new account and to anonymous visitors", async () => {
    const matches = await page("/matches", { headers: { cookie } })
    const matchId = /href="\/matches\/([^"/?#]+)"/.exec(matches.html)?.[1]
    assert.ok(matchId, "the development database has a match to save")
    const saved = await fetch(url("/matches"), {
      method: "POST",
      headers: { "next-action": actionId("setMatchWatchlisted"), "content-type": "text/plain;charset=UTF-8", origin: origin(), cookie },
      body: JSON.stringify([matchId, true]),
    })
    assert.ok(saved.status < 400, `saving answered ${saved.status}`)
    await saved.text()
    const own = await page("/watchlist", { headers: { cookie } })
    assert.ok(own.html.includes(`/matches/${matchId}`), "the owner sees the saved match")

    const other = await signUp("bob")
    assert.equal(other.status, 200)
    const theirs = await page("/watchlist", { headers: { cookie: other.cookie } })
    assert.equal(theirs.status, 200)
    assert.ok(!theirs.html.includes(`/matches/${matchId}`), "another account does not")
    assert.ok(!theirs.html.includes(email("alice")))
    await post("/sign-out", {}, other.cookie)
  })

  it("sign out, then sign in again with the same password", async () => {
    const out = await post("/sign-out", {}, cookie)
    assert.equal(out.status, 200)
    assert.equal(await session(cookie), null, "the old cookie no longer resolves")
    assert.match((await page("/dashboard", { headers: { cookie } })).html, DEMO_MARKER)

    const wrong = await post("/sign-in/email", { email: email("alice"), password: "not the password 1" })
    assert.equal(wrong.status, 401)
    const back = await post("/sign-in/email", { email: email("alice"), password: PASSWORD })
    assert.equal(back.status, 200)
    assert.equal((await session(back.cookie))?.user?.role, "USER")
    await post("/sign-out", {}, back.cookie)
  })

  it("documents the known leak: an address that already has an account answers differently (422)", async () => {
    // Not a goal: this pins Better Auth's behaviour in unverified auto-sign-in mode so a change is noticed.
    // docs/security/production-hardening.md, "Public sign-up without email verification".
    const duplicate = await signUp("alice")
    assert.equal(duplicate.status, 422)
    assert.equal(duplicate.json?.code, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL")
    assert.equal(duplicate.cookie, "")
  })
})
