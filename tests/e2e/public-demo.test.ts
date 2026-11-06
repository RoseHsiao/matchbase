import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { after, before, describe, it } from "node:test"

import { actionId, assertLocalTarget, BASE, DATABASE_DOWN, devAccount, origin, page, rscPage, signInCookie, url } from "./support"

/**
 * The public demo and its boundaries over HTTP against a running local server,
 * started with public sign-up closed. Set MATCHBASE_E2E_DATABASE=unreachable
 * when the server has an unreachable DATABASE_URL, which also runs the failed
 * session cases and proves the demo needs no database (docs/public-demo.md).
 */

const describeE2e = BASE ? describe : describe.skip
const DEMO_MARKER = /exploring the demo/
const DEMO_RECORDS = /Redbrook Rovers|Kestrel Bay|Glasswing One/
const USER = devAccount("USER")
const ADMIN = devAccount("ADMIN")

async function actionIds(): Promise<string[]> {
  const { html } = await page("/dashboard")
  return [...new Set([...html.matchAll(/\\"id\\":\\"([0-9a-f]{40,})\\"/g)].map((match) => match[1]))]
}

function callAction(id: string, args: unknown[], headers: Record<string, string> = {}, path = "/dashboard") {
  return fetch(url(path), {
    method: "POST",
    redirect: "manual",
    headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", origin: origin(), ...headers },
    body: JSON.stringify(args),
  })
}

describeE2e("public demo as an anonymous visitor", () => {
  before(assertLocalTarget)

  it("the landing page offers the demo and sign in, and no sign-up", async () => {
    const { status, html } = await page("/")
    assert.equal(status, 200)
    assert.match(html, /Explore Demo/)
    assert.match(html, /href="\/dashboard"/)
    assert.match(html, /href="\/sign-in"/)
    assert.doesNotMatch(html, /href="\/sign-up/)
    assert.match(html, /fictional/)
  })

  const demoPages: [string, RegExp][] = [
    ["/dashboard", /Today&#x27;s matches|Today's matches/],
    ["/schedule", /Schedule/],
    ["/matches", /Redbrook Rovers/],
    ["/matches/demo-match-1", /Match information/],
    ["/teams", /Redbrook Rovers/],
    ["/teams/redbrook-rovers", /Meridian Football League/],
    ["/players", /Theo Ashgrove/],
    ["/players/theo-ashgrove", /Redbrook Rovers/],
    ["/leagues/meridian-league", /Meridian Football League/],
    ["/leagues/hollow-oak-open", /Edition 14/],
    ["/leagues/sunrise-rift", /Sunrise Rift League/],
    ["/history", /History/],
  ]
  for (const [path, content] of demoPages) {
    it(`${path} renders demo data and says it is a demo`, async () => {
      const { status, html } = await page(path)
      assert.equal(status, 200)
      assert.match(html, content)
      assert.match(html, DEMO_MARKER)
      assert.match(html, /fictional/)
    })
  }

  it("real records are not reachable through the demo", async () => {
    for (const path of ["/teams/arsenal", "/players/saka", "/leagues/epl", "/matches/m-epl-ars-che"]) {
      assert.equal((await page(path)).status, 404, path)
    }
  })

  it("demo pages link to nothing protected and carry no account data", async () => {
    const { html } = await page("/dashboard")
    assert.doesNotMatch(html, /href="\/admin|href="\/watchlist/)
    assert.doesNotMatch(html, /@matchbase|@example|neondb|postgres(ql)?:\/\//i)
  })

  for (const path of ["/watchlist", "/admin", "/admin/teams", "/admin/data-sources", "/admin/sync-logs", "/admin/monitoring", "/admin/settings"]) {
    it(`${path} sends an anonymous visitor to sign in`, async () => {
      const { status, location } = await page(path)
      assert.ok(status === 307 || status === 303, `status ${status}`)
      assert.match(location ?? "", /\/sign-in\?next=/)
    })
  }

  it("a client-navigation request that skips the admin layout's guard still gets no admin data", async () => {
    // The router names the layouts it already has, and the server does not re-run them. This is why the layout is
    // not the boundary: the request reaches the page, and the page holds nothing but a client view with no data.
    const tree = encodeURIComponent(JSON.stringify(["", { children: ["(app)", { children: ["admin", { children: ["__PAGE__", {}] }] }] }]))
    const views: [string, RegExp][] = [["/admin/teams", /AdminTeamsView/], ["/admin/data-sources", /AdminDataSourcesView/], ["/admin/sync-logs", /AdminSyncLogsView/], ["/admin/monitoring", /AdminMonitoringView/]]
    for (const [path, view] of views) {
      const { status, html } = await rscPage(path, { "next-router-state-tree": tree })
      assert.equal(status, 200, path)
      assert.match(html, view, `${path}: the request must really reach the page, or this test proves nothing`)
      assert.doesNotMatch(html, /syncLogs|dataSources|apiKey|lastSyncedAt|"logoUrl"|"email"|Redbrook/, path)
      assert.ok(html.length < 20_000, `${path} carries ${html.length} bytes`)
    }
  })

  it("a forged session cookie grants nothing", async () => {
    const headers = { cookie: "better-auth.session_token=forged.forged; __Secure-better-auth.session_token=forged.forged" }
    assert.match((await page("/admin", { headers })).location ?? "", /\/sign-in/)
    assert.match((await page("/dashboard", { headers })).html, DEMO_MARKER)
  })

  it("cron endpoints refuse a caller without the secret, or with a wrong one", async () => {
    for (const path of ["/api/cron/sync", "/api/cron/notifications"]) {
      for (const headers of [{}, { authorization: "Bearer wrong-secret-wrong-secret" }] as Record<string, string>[]) {
        const { status } = await page(path, { headers })
        assert.ok(status === 401 || status === 503, `${path} answered ${status}`)
      }
    }
  })

  it("auth endpoints that act on an account refuse an anonymous caller", async () => {
    const posts = ["/update-user", "/change-password", "/change-email", "/delete-user", "/revoke-sessions", "/revoke-session", "/revoke-other-sessions", "/set-password", "/unlink-account", "/verify-password"]
    const gets = ["/list-sessions", "/list-accounts", "/account-info"]
    for (const path of posts) {
      const { status } = await page(`/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: origin() }, body: "{}" })
      assert.ok(status >= 400 && status < 500, `${path} answered ${status}`)
    }
    for (const path of gets) {
      const { status } = await page(`/api/auth${path}`)
      assert.ok(status >= 400 && status < 500, `${path} answered ${status}`)
    }
    const session = await page("/api/auth/get-session")
    assert.equal(session.status, 200)
    assert.equal(session.html.trim(), "null")
  })

  it("sign-up is closed: no link on sign-in, and the endpoint refuses", async () => {
    const signIn = await page("/sign-in")
    assert.equal(signIn.status, 200)
    assert.doesNotMatch(signIn.html, /Create one|href="\/sign-up/, "start the server with AUTH_ALLOW_SIGN_UP=false")
    assert.match(signIn.html, /Explore demo/)

    const { status } = await page("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: origin() },
      body: JSON.stringify({ name: "Probe", email: "public-demo-probe@example.test", password: "public-demo-probe-1" }),
    })
    assert.ok(status >= 400 && status < 500, `sign-up answered ${status}`)
  })

  it("the Server Actions the demo page references refuse an anonymous caller", async () => {
    const ids = await actionIds()
    assert.ok(ids.length >= 4, `expected the four store actions, found ${ids.length}`)
    for (const id of ids) {
      const response = await callAction(id, ["redbrook-rovers", true])
      const text = await response.text()
      // Void actions reject; setWatchlistReminder reports the failure in its result.
      assert.ok(response.status >= 400 || /"ok":false/.test(text), `action answered ${response.status}`)
    }
  })

  it("no anonymous response may be cached by anything shared", async () => {
    for (const path of ["/", "/dashboard", "/matches", "/teams/redbrook-rovers", "/sign-in"]) {
      for (const response of [await page(path), await rscPage(path)]) {
        assert.match(response.headers.get("cache-control") ?? "", /no-store/, path)
        assert.equal(response.headers.get("x-nextjs-cache"), null, path)
        assert.equal(response.headers.get("x-nextjs-prerender"), null, path)
      }
    }
  })
})

/** Ids that do not exist, so even a broken guard could not change a real row. */
const ADMIN_ACTIONS: [string, unknown[]][] = [
  ["saveAdminRecord", ["teams", { id: "e2e-probe-does-not-exist", name: "Probe" }]],
  ["deleteAdminRecord", ["teams", "e2e-probe-does-not-exist"]],
  ["runDataSourceSync", ["e2e-probe-does-not-exist"]],
]
/** Field names only the admin snapshot carries. A positive control below proves they do appear for an administrator. */
const ADMIN_SNAPSHOT = /dataSources|syncLogs/

describeE2e("admin actions are protected by themselves, with no admin page involved", () => {
  before(assertLocalTarget)

  for (const [name, args] of ADMIN_ACTIONS) {
    it(`${name} called directly by id refuses an anonymous caller before doing anything`, async () => {
      const response = await callAction(actionId(name), args, {}, "/admin")
      assert.match(await response.text(), /"ok":false,"error":"Sign in as an administrator to make changes\."/)
    })
  }
})

const describeDown = BASE && DATABASE_DOWN ? describe : describe.skip

describeDown("a session that cannot be checked is not an anonymous visitor (database unreachable)", () => {
  before(assertLocalTarget)
  const secret = process.env.BETTER_AUTH_SECRET ?? ""
  const value = "a-session-token"
  const signature = createHmac("sha256", secret).update(value).digest("base64")
  const cookie = `better-auth.session_token=${encodeURIComponent(`${value}.${signature}`)}; __Secure-better-auth.session_token=${encodeURIComponent(`${value}.${signature}`)}`

  for (const path of ["/dashboard", "/matches", "/teams/redbrook-rovers", "/"]) {
    it(`${path} fails explicitly and shows no demo data`, async () => {
      const { status, html } = await page(path, { headers: { cookie } })
      assert.equal(status, 500)
      assert.doesNotMatch(html, DEMO_MARKER)
      assert.doesNotMatch(html, DEMO_RECORDS)
      assert.doesNotMatch(html, /ECONNREFUSED|postgres(ql)?:\/\//i)
    })
  }

  for (const path of ["/admin", "/watchlist"]) {
    it(`${path} fails explicitly rather than asking for sign-in`, async () => {
      const { status, location } = await page(path, { headers: { cookie } })
      assert.equal(status, 500)
      assert.equal(location, null)
    })
  }

  it("a Server Action fails explicitly rather than answering 'sign in'", async () => {
    for (const id of await actionIds()) {
      const response = await callAction(id, ["redbrook-rovers", true], { cookie })
      const text = await response.text()
      assert.ok(response.status >= 500, `action answered ${response.status}`)
      assert.doesNotMatch(text, /Sign in to/)
    }
  })

  it("the same visitor without the cookie is simply in the demo", async () => {
    assert.match((await page("/dashboard")).html, DEMO_MARKER)
  })
})

const describeAccounts = BASE && !DATABASE_DOWN && USER && ADMIN ? describe : describe.skip

describeAccounts("responses never cross between sessions", () => {
  let userCookie = ""
  let adminCookie = ""

  before(async () => {
    assertLocalTarget()
    userCookie = await signInCookie(USER!)
    adminCookie = await signInCookie(ADMIN!)
  })

  after(async () => {
    for (const cookie of [userCookie, adminCookie]) {
      await page("/api/auth/sign-out", { method: "POST", headers: { cookie, origin: origin(), "content-type": "application/json" }, body: "{}" })
    }
  })

  function assertIdentity(html: string, who: "anonymous" | "user" | "admin", context: string) {
    const expectIn = (needle: string, present: boolean, label: string) => assert.equal(html.includes(needle), present, `${context}: ${label}`)
    expectIn(USER!.email, who === "user", "USER email")
    expectIn(ADMIN!.email, who === "admin", "ADMIN email")
    assert.equal(DEMO_MARKER.test(html), who === "anonymous", `${context}: demo banner`)
    assert.equal(DEMO_RECORDS.test(html), who === "anonymous", `${context}: demo records`)
  }

  it("interleaved requests from three visitors each see only their own state, on every shared route", async () => {
    const paths = ["/dashboard", "/matches", "/teams", "/players", "/schedule", "/history"]
    const visitors = [
      { who: "anonymous", headers: {} },
      { who: "user", headers: { cookie: userCookie } },
      { who: "admin", headers: { cookie: adminCookie } },
    ] as { who: "anonymous" | "user" | "admin"; headers: Record<string, string> }[]
    for (let round = 0; round < 3; round += 1) {
      await Promise.all(paths.flatMap((path) => visitors.map(async ({ who, headers }) => {
        const { status, html } = await page(path, { headers })
        assert.equal(status, 200, `${who} ${path}`)
        assertIdentity(html, who, `${who} ${path}`)
      })))
    }
  })

  it("the client-navigation payload is as isolated as the document", async () => {
    await Promise.all([
      rscPage("/matches").then(({ html }) => assert.match(html, DEMO_RECORDS)),
      rscPage("/matches", { cookie: userCookie }).then(({ html }) => assert.doesNotMatch(html, DEMO_RECORDS)),
    ])
  })

  it("signed-in responses are never cacheable by anything shared", async () => {
    for (const path of ["/dashboard", "/watchlist", "/matches", "/admin"]) {
      for (const response of [await page(path, { headers: { cookie: adminCookie } }), await rscPage(path, { cookie: adminCookie })]) {
        assert.match(response.headers.get("cache-control") ?? "", /no-store/, path)
        assert.equal(response.headers.get("x-nextjs-cache"), null, path)
      }
    }
  })

  it("a signed-in viewer cannot open a demo record, and an anonymous one cannot open a real one", async () => {
    assert.equal((await page("/teams/redbrook-rovers", { headers: { cookie: userCookie } })).status, 404)
    assert.equal((await page("/matches/demo-match-1", { headers: { cookie: userCookie } })).status, 404)
    assert.equal((await page("/teams/arsenal")).status, 404)
  })

  it("the Watchlist belongs to its own session", async () => {
    const [mine, theirs] = await Promise.all([page("/watchlist", { headers: { cookie: userCookie } }), page("/watchlist", { headers: { cookie: adminCookie } })])
    assertIdentity(mine.html, "user", "USER /watchlist")
    assertIdentity(theirs.html, "admin", "ADMIN /watchlist")
  })

  it("roles are enforced on the server", async () => {
    assert.match((await page("/admin", { headers: { cookie: userCookie } })).html, /Administrators only/)
    const admin = await page("/admin", { headers: { cookie: adminCookie } })
    assert.equal(admin.status, 200)
    assert.doesNotMatch(admin.html, /Administrators only/)
  })

  for (const [name, args] of ADMIN_ACTIONS) {
    it(`${name} called directly by id refuses a USER before doing anything`, async () => {
      const response = await callAction(actionId(name), args, { cookie: userCookie }, "/admin")
      assert.match(await response.text(), /"ok":false,"error":"Only administrators can make changes\."/)
    })
  }

  it("the admin snapshot reaches an administrator and nobody else", async () => {
    const tree = encodeURIComponent(JSON.stringify(["", { children: ["(app)", { children: ["admin", { children: ["__PAGE__", {}] }] }] }]))
    assert.match((await page("/admin/teams", { headers: { cookie: adminCookie } })).html, ADMIN_SNAPSHOT, "positive control: these markers are real")
    for (const [who, headers] of [["USER", { cookie: userCookie }], ["anonymous", {}]] as [string, Record<string, string>][]) {
      assert.doesNotMatch((await page("/admin/teams", { headers })).html, ADMIN_SNAPSHOT, `${who} document`)
      const skipped = await rscPage("/admin/teams", { ...headers, "next-router-state-tree": tree })
      assert.match(skipped.html, /AdminTeamsView/, `${who}: the request must reach the page`)
      assert.doesNotMatch(skipped.html, ADMIN_SNAPSHOT, `${who} skipping the layout`)
    }
  })

  it("the same browser moving between states gets the right catalogue each time", async () => {
    assertIdentity((await page("/matches")).html, "anonymous", "before sign-in")
    const cookie = await signInCookie(USER!)
    assertIdentity((await page("/matches", { headers: { cookie } })).html, "user", "after sign-in")
    await page("/api/auth/sign-out", { method: "POST", headers: { cookie, origin: origin(), "content-type": "application/json" }, body: "{}" })
    assertIdentity((await page("/matches", { headers: { cookie } })).html, "anonymous", "a revoked session is anonymous")
    assert.match((await page("/admin", { headers: { cookie } })).location ?? "", /\/sign-in/)
  })
})
