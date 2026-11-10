import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"

import { assertLocalTarget, BASE, DATABASE_DOWN, deleteStampedAccounts, devAccount, e2eStamp, SIGN_UP_OPEN, url } from "./support"

/**
 * The essential journeys in real headless Chrome, driven over the DevTools
 * protocol with Node's built-in WebSocket, so no browser framework is added.
 * Needs a running local server (docs/public-demo.md) and Chrome; set
 * MATCHBASE_E2E_CHROME if it is not in the default macOS or Linux location.
 *
 * Every console error, uncaught exception, CSP violation and failed response is
 * collected. A failure a step causes on purpose is declared with `expectFailure`
 * and must then occur exactly once, so it is asserted rather than ignored, and
 * anything left over fails the suite.
 */

const CHROME = [process.env.MATCHBASE_E2E_CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => path && existsSync(path))
const USER = devAccount("USER")
const ADMIN = devAccount("ADMIN")
const PORT = 9400 + (process.pid % 400)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const describeBrowser = BASE && CHROME && USER && ADMIN && !DATABASE_DOWN ? describe : describe.skip

type ProtocolEvent = {
  exceptionDetails: { text: string; exception?: { description?: string } }
  type: string
  args: { value?: unknown; description?: string }[]
  entry: { level: string; text: string; url?: string }
  response: { status: number; url: string }
  request: { url: string; headers: Record<string, string> }
}
type ProtocolResult = { result?: { value?: unknown }; exceptionDetails?: unknown }
type Problem = { kind: "console" | "exception" | "log" | "response"; text: string; url?: string; status?: number }
type Expected = { pattern: RegExp; status?: number; label: string; seen: number }

class Tab {
  private seq = 0
  /** Server requests since the last `resetRequests`: everything but static assets and prefetches. */
  serverRequests: string[] = []
  private pending = new Map<number, (message: { result?: ProtocolResult }) => void>()

  private constructor(private ws: WebSocket, readonly problems: Problem[]) {
    ws.onmessage = ({ data }) => this.receive(JSON.parse(String(data)))
  }

  static async open(wsUrl: string, problems: Problem[]): Promise<Tab> {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve) => (ws.onopen = resolve))
    const tab = new Tab(ws, problems)
    for (const domain of ["Page", "Runtime", "Log", "Network"]) await tab.send(`${domain}.enable`)
    return tab
  }

  private receive(message: { id?: number; method?: string; params?: ProtocolEvent; result?: ProtocolResult }) {
    if (message.id) {
      this.pending.get(message.id)?.(message)
      this.pending.delete(message.id)
      return
    }
    const params = (message.params ?? {}) as ProtocolEvent
    if (message.method === "Network.requestWillBeSent") {
      const { url: requestUrl, headers } = params.request
      const prefetch = Object.keys(headers).some((name) => name.toLowerCase() === "next-router-prefetch")
      if (requestUrl.startsWith("http") && !requestUrl.includes("/_next/static/") && !prefetch) this.serverRequests.push(requestUrl)
    }
    if (message.method === "Runtime.exceptionThrown") this.problems.push({ kind: "exception", text: String(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text) })
    if (message.method === "Runtime.consoleAPICalled" && params.type === "error") this.problems.push({ kind: "console", text: params.args.map((arg) => arg.value ?? arg.description).join(" ") })
    // "Failed to load resource" repeats what Network reports, with its status, so it is counted once, there.
    if (message.method === "Log.entryAdded" && params.entry.level === "error" && !/^Failed to load resource/.test(params.entry.text)) this.problems.push({ kind: "log", text: params.entry.text, url: params.entry.url })
    if (message.method === "Network.responseReceived" && params.response.status >= 400) this.problems.push({ kind: "response", text: `${params.response.status} ${params.response.url}`, url: params.response.url, status: params.response.status })
  }

  send(method: string, params: Record<string, unknown> = {}) {
    return new Promise<{ result?: ProtocolResult }>((resolve) => {
      const id = ++this.seq
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const { result } = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (result?.exceptionDetails) throw new Error(`Browser evaluation failed: ${expression.slice(0, 100)}`)
    return result?.result?.value as T
  }

  async until(condition: () => Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        if (await condition()) return
      } catch {
        // The page is navigating; ask again.
      }
      await sleep(100)
    }
    assert.fail(`Timed out waiting for ${what}; at ${await this.path()}`)
  }

  path = () => this.evaluate<string>("location.pathname + location.search")
  text = () => this.evaluate<string>("document.body.innerText")
  hrefs = () => this.evaluate<(string | null)[]>("[...document.querySelectorAll('a')].map((a) => a.getAttribute('href'))")

  async go(path: string, arrived: (at: string) => boolean = (at) => at === path) {
    await this.send("Page.navigate", { url: url(path) })
    await this.until(async () => (await this.evaluate("document.readyState")) === "complete" && arrived(await this.path()), `${path} to load`)
    await this.hydrated()
  }

  /** React attaches its listeners on hydration; a click before that does nothing. */
  async hydrated() {
    await this.until(() => this.evaluate<boolean>(`(() => { const el = document.querySelector('a, button'); return !!el && Object.keys(el).some((key) => key.startsWith('__react')) })()`), "hydration")
  }

  async click(selector: string) {
    await this.until(() => this.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`), `${selector} to appear`)
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  }

  async clickText(label: string) {
    const find = `[...document.querySelectorAll('a,button,[role=menuitem]')].find((el) => el.innerText.trim().startsWith(${JSON.stringify(label)}))`
    await this.until(() => this.evaluate<boolean>(`!!${find}`), `"${label}" to appear`)
    await this.evaluate(`${find}.click()`)
  }

  /** Lets the page finish its own loading, then starts counting from zero. */
  async resetRequests() {
    await sleep(1_500)
    this.serverRequests = []
  }

  /** Moves the page's clock forward, without making the suite wait for real. */
  advanceClock(ms: number) {
    return this.evaluate(`(() => { window.__real ??= Date.now; window.__offset = (window.__offset ?? 0) + ${ms}; Date.now = () => window.__real() + window.__offset })()`)
  }

  /** Stands in for the tab being hidden or shown; headless Chrome cannot background a tab. */
  setVisibility(state: "visible" | "hidden") {
    return this.evaluate(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ${JSON.stringify(state)} })`)
  }

  /** Both events a browser fires when someone returns to a tab. */
  returnToTab() {
    return this.evaluate(`(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) })()`)
  }

  /** Every team badge on the page, as the browser actually laid it out. */
  badges() {
    return this.evaluate<{ code: string; ring: boolean; width: number; height: number; overflow: boolean }[]>(`[...document.querySelectorAll('[data-slot=avatar-fallback]')].filter((el) => el.style.backgroundColor).map((el) => {
      const box = el.getBoundingClientRect()
      return { code: el.textContent, ring: getComputedStyle(el).boxShadow !== 'none', width: box.width, height: box.height, overflow: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight }
    })`)
  }

  /** Types through React's own value setter, so the form sees it. */
  async submitSignIn(email: string, password: string) {
    await this.evaluate(`(() => {
      const set = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }
      set(document.querySelector('input[type=email]'), ${JSON.stringify(email)})
      set(document.querySelector('input[type=password]'), ${JSON.stringify(password)})
      document.querySelector('form button[type=submit]').click()
    })()`)
  }

  async signIn(account: { email: string; password: string }) {
    await this.go("/sign-in")
    await this.submitSignIn(account.email, account.password)
    await this.until(async () => (await this.path()) === "/dashboard" && !/exploring the demo/.test(await this.text()), "the signed-in dashboard")
    await this.hydrated()
  }

  async signOut() {
    await this.send("Page.bringToFront")
    const box = await this.evaluate<{ x: number; y: number }>(`(() => { const b = [...document.querySelectorAll('[data-slot=sidebar-footer] button')].at(-1).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
    for (const type of ["mousePressed", "mouseReleased"]) await this.send("Input.dispatchMouseEvent", { type, ...box, button: "left", clickCount: 1 })
    await this.clickText("Sign out")
    await this.until(async () => (await this.path()) === "/" && /Explore Demo/.test(await this.text()), "the landing page after sign-out")
    await this.hydrated()
  }

  close() {
    this.ws.close()
  }
}

describeBrowser("browser smoke: public demo and authorized sign-in", () => {
  let chrome: ChildProcess
  let profile: string
  let tab: Tab
  const problems: Problem[] = []
  const expected: Expected[] = []
  let signedInBadgeSize = { width: 0, height: 0 }

  /** Declares a failure the next step causes on purpose. It must then happen exactly once. */
  function expectFailure(label: string, pattern: RegExp, status?: number) {
    expected.push({ label, pattern, status, seen: 0 })
  }

  async function newTab(): Promise<Tab> {
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json() as { webSocketDebuggerUrl: string }
    return Tab.open(target.webSocketDebuggerUrl, problems)
  }

  before(async () => {
    assertLocalTarget()
    profile = mkdtempSync(join(tmpdir(), "matchbase-smoke-"))
    chrome = spawn(CHROME!, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" })
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(250)
      try {
        await fetch(`http://127.0.0.1:${PORT}/json/version`)
        tab = await newTab()
        break
      } catch {
        // Chrome is still starting.
      }
    }
    assert.ok(tab, "Chrome did not start")
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  })

  after(async () => {
    tab?.close()
    chrome?.kill()
    await sleep(300)
    if (profile) rmSync(profile, { recursive: true, force: true })
  })

  it(`landing page: Explore Demo and Sign in, ${SIGN_UP_OPEN ? "and Create account" : "no sign-up"}`, async () => {
    await tab.go("/")
    const text = await tab.text()
    assert.match(text, /Explore Demo/)
    assert.match(text, /Sign in/)
    assert.match(text, /fictional/)
    if (SIGN_UP_OPEN) {
      assert.match(text, /Create account/)
      assert.ok((await tab.hrefs()).includes("/sign-up"))
    } else {
      assert.doesNotMatch(text, /Create (an )?account|Sign up/i)
      assert.ok(!(await tab.hrefs()).some((href) => href?.startsWith("/sign-up")))
    }
  })

  it("the demo says what it is, and offers nothing private", async () => {
    await tab.clickText("Explore Demo")
    await tab.until(async () => (await tab.path()) === "/dashboard", "the dashboard")
    await tab.until(async () => /exploring the demo/.test(await tab.text()), "the demo banner")
    await tab.hydrated()
    const text = await tab.text()
    assert.match(text, /fictional/)
    assert.match(text, /not signed in/)
    assert.match(text, /Public demo/)
    assert.doesNotMatch(text, /Sign out|Administrator|Member/)
    const hrefs = await tab.hrefs()
    assert.ok(!hrefs.some((href) => /^\/(admin|watchlist)/.test(href ?? "")), "no links to protected routes")
    assert.ok(hrefs.includes("/sign-in"))
  })

  it("anonymous browsing works by following real links", async () => {
    await tab.click('a[href^="/matches/demo-match-"]')
    await tab.until(async () => /Match information/.test(await tab.text()), "a match page")
    await tab.click('a[href^="/leagues/"]')
    await tab.until(async () => /^\/leagues\//.test(await tab.path()), "a league page")
    for (const path of ["/schedule", "/matches", "/teams", "/players", "/history"]) {
      await tab.click(`[data-slot=sidebar] a[href="${path}"]`)
      await tab.until(async () => (await tab.path()) === path, path)
      assert.match(await tab.text(), /exploring the demo/, path)
    }
  })

  it("a control that would write sends the visitor to sign in, with a way back to the demo", async () => {
    await tab.go("/teams/redbrook-rovers")
    await tab.clickText("Follow")
    await tab.until(async () => (await tab.path()) === "/sign-in?next=%2Fteams", "the sign-in page")
    await tab.hydrated()
    const text = await tab.text()
    assert.match(text, /Explore demo/)
    if (SIGN_UP_OPEN) assert.match(text, /Create one/)
    else assert.doesNotMatch(text, /Create one/)
    await tab.clickText("Explore demo")
    await tab.until(async () => (await tab.path()) === "/dashboard", "the demo")
  })

  it("anonymous visitors are refused /admin and /watchlist", async () => {
    await tab.go("/admin", (at) => at.startsWith("/sign-in"))
    assert.equal(await tab.path(), "/sign-in?next=%2Fadmin")
    await tab.go("/watchlist", (at) => at.startsWith("/sign-in"))
    assert.equal(await tab.path(), "/sign-in?next=%2Fwatchlist")
  })

  it("a wrong password is refused with a message and exactly one 401", async () => {
    await tab.go("/sign-in")
    expectFailure("the wrong-password request", /\/api\/auth\/sign-in\/email$/, 401)
    await tab.submitSignIn("nobody@example.test", "not-the-right-password-1")
    await tab.until(async () => /Email or password is incorrect/.test(await tab.text()), "the error message")
    assert.equal(await tab.path(), "/sign-in")
  })

  it("USER signs in: real shell, own Watchlist, Admin refused", async () => {
    await tab.signIn(USER!)
    const text = await tab.text()
    assert.doesNotMatch(text, /exploring the demo|Public demo/)
    assert.match(text, /Match tracker/)
    const hrefs = await tab.hrefs()
    assert.ok(hrefs.includes("/watchlist"))
    assert.ok(!hrefs.some((href) => href?.startsWith("/admin")))
    await tab.go("/watchlist")
    assert.match(await tab.text(), /Watchlist/)
    await tab.go("/admin")
    assert.match(await tab.text(), /Administrators only/)
    await tab.go("/", (at) => at === "/dashboard")
  })

  it("the signed-in catalogue is not the demo", async () => {
    await tab.go("/teams")
    assert.doesNotMatch(await tab.text(), /Redbrook Rovers/)
  })

  it("teams from the database have no ring, and the same badge size as the demo", async () => {
    await tab.go("/teams")
    const badges = await tab.badges()
    assert.ok(badges.length > 0, "the dev database has teams to check")
    assert.ok(badges.every((badge) => !badge.ring), "no real team has a secondary colour")
    assert.ok(badges.every((badge) => !badge.overflow))
    signedInBadgeSize = { width: badges[0].width, height: badges[0].height }
  })

  it("USER signs out: landing page, then the demo again", async () => {
    await tab.go("/dashboard")
    await tab.signOut()
    await tab.go("/dashboard")
    assert.match(await tab.text(), /exploring the demo/)
    assert.doesNotMatch(await tab.text(), /Match tracker/)
  })

  it("the Back button after sign-out shows no signed-in page", async () => {
    await tab.signIn(USER!)
    await tab.go("/watchlist")
    await tab.click('[data-slot=sidebar] a[href="/matches"]')
    await tab.until(async () => (await tab.path()) === "/matches", "/matches")
    await tab.signOut()
    await tab.evaluate("history.back()")
    await tab.until(async () => (await tab.path()) !== "/", "the previous entry")
    await sleep(1500)
    const text = await tab.text()
    assert.doesNotMatch(text, new RegExp(USER!.email.replace(/[.]/g, "\\.")), "no account details after sign-out")
    assert.doesNotMatch(text, /Match tracker/)
    assert.match(text, /exploring the demo/)
  })

  it("signing out in another tab updates this one, so its shell never disagrees with its data", async () => {
    await tab.signIn(USER!)
    const other = await newTab()
    await other.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
    await other.go("/dashboard")
    await other.signOut()
    other.close()
    await tab.send("Page.bringToFront")
    await tab.click('[data-slot=sidebar] a[href="/teams"]')
    await tab.until(async () => (await tab.path()) === "/teams", "/teams")
    await tab.until(async () => /Redbrook Rovers/.test(await tab.text()), "the catalogue a signed-out visitor gets")
    await tab.until(async () => /exploring the demo/.test(await tab.text()) && !/Match tracker/.test(await tab.text()), "the demo shell to match the demo data", 5_000)
    assert.ok(!(await tab.hrefs()).includes("/watchlist"), "the signed-in navigation is gone")
  })

  describe("session refresh makes no needless requests", () => {
    const IDLE_MS = Number(process.env.MATCHBASE_E2E_IDLE_MS ?? 5_000)

    before(async () => {
      await tab.signIn(USER!)
    })

    it("an open tab left alone makes no requests: nothing polls", async () => {
      await tab.go("/dashboard")
      await tab.resetRequests()
      await sleep(IDLE_MS)
      assert.deepEqual(tab.serverRequests, [])
    })

    it("regaining focus within the minute makes no request", async () => {
      await tab.go("/dashboard")
      await tab.resetRequests()
      for (let time = 0; time < 3; time += 1) await tab.returnToTab()
      await sleep(1_000)
      assert.deepEqual(tab.serverRequests, [])
    })

    it("returning after the minute makes exactly one request, then none until the next minute", async () => {
      await tab.go("/dashboard")
      await tab.resetRequests()
      await tab.advanceClock(61_000)
      await tab.returnToTab()
      await sleep(1_500)
      assert.equal(tab.serverRequests.length, 1, tab.serverRequests.join())
      await tab.returnToTab()
      await sleep(800)
      assert.equal(tab.serverRequests.length, 1, "throttled")
    })

    it("a hidden tab makes no request, however much time has passed", async () => {
      await tab.go("/dashboard")
      await tab.resetRequests()
      await tab.setVisibility("hidden")
      await tab.advanceClock(600_000)
      await tab.returnToTab()
      await sleep(1_000)
      assert.deepEqual(tab.serverRequests, [])
      await tab.setVisibility("visible")
    })

    it("a hidden tab told of a session change waits, then refreshes once when shown", async () => {
      await tab.go("/dashboard")
      await tab.resetRequests()
      await tab.setVisibility("hidden")
      await tab.evaluate(`(() => { const channel = new BroadcastChannel('matchbase-auth'); channel.postMessage('another-tab'); channel.close() })()`)
      await sleep(1_000)
      assert.deepEqual(tab.serverRequests, [], "no request while hidden")
      await tab.setVisibility("visible")
      await tab.returnToTab()
      await sleep(1_500)
      assert.equal(tab.serverRequests.length, 1, "one refresh on return, even inside the minute")
    })

    it("a visible tab told of a session change refreshes at once", async () => {
      await tab.go("/dashboard")
      await tab.resetRequests()
      await tab.evaluate(`(() => { const channel = new BroadcastChannel('matchbase-auth'); channel.postMessage('another-tab'); channel.close() })()`)
      await sleep(1_500)
      assert.equal(tab.serverRequests.length, 1, tab.serverRequests.join())
    })

    it("signing out does not make the tab refresh itself a second time", async () => {
      await tab.go("/dashboard")
      await tab.resetRequests()
      await tab.signOut()
      await sleep(1_000)
      const refreshes = tab.serverRequests.filter((request) => /[?&]_rsc/.test(request))
      console.log(`sign-out refreshes: ${refreshes.length}`)
      assert.ok(refreshes.length <= 2, `the navigation and its refresh, no more; saw ${refreshes.length}`)
    })
  })

  it("a session that ends without this tab knowing is picked up when the tab regains focus", async () => {
    await tab.signIn(USER!)
    await tab.evaluate(`fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status)`)
    assert.match(await tab.text(), /Match tracker/, "nothing has told the tab yet")
    // Past the once-a-minute limit, without making the suite wait a minute.
    await tab.evaluate(`(() => { const real = Date.now; const later = real() + 61_000; Date.now = () => Math.max(real(), later); window.dispatchEvent(new Event('focus')) })()`)
    await tab.until(async () => /exploring the demo/.test(await tab.text()) && !/Match tracker/.test(await tab.text()), "the demo shell", 5_000)
    await tab.go("/dashboard")
  })

  for (const theme of ["light", "dark"] as const) {
    it(`demo team badges in ${theme} mode: 27 ringed, same size as real ones, nothing clipped`, async () => {
      await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] })
      await tab.go("/teams")
      assert.equal(await tab.evaluate("document.documentElement.classList.contains('dark')"), theme === "dark")
      const badges = await tab.badges()
      assert.equal(badges.length, 27)
      assert.ok(badges.every((badge) => badge.ring), "every demo team has its ring")
      assert.ok(badges.every((badge) => !badge.overflow), "no code overflows its badge")
      for (const badge of badges) assert.deepEqual({ width: badge.width, height: badge.height }, signedInBadgeSize, badge.code ?? "")
      assert.ok(await tab.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "no page overflow")
      await tab.send("Emulation.setEmulatedMedia", { features: [] })
    })
  }

  it("ADMIN signs in and opens Admin, then signs out", async () => {
    await tab.signIn(ADMIN!)
    assert.ok((await tab.hrefs()).includes("/admin"))
    await tab.go("/admin")
    assert.doesNotMatch(await tab.text(), /Administrators only/)
    await tab.go("/admin/teams")
    assert.doesNotMatch(await tab.text(), /Administrators only/)
    await tab.go("/dashboard")
    await tab.signOut()
  })

  describe("public sign-up in the browser (server started with sign-up open)", { skip: !SIGN_UP_OPEN }, () => {
    const stamp = e2eStamp()
    const account = { email: `e2e-browser-signup-${stamp}@example.test`, password: "e2e browser sign-up 1" }

    after(async () => {
      const removed = await deleteStampedAccounts("e2e-browser-signup-", stamp)
      assert.ok(removed <= 1, `removed ${removed} stamped accounts`)
    })

    it("from the demo banner: the form says the address is unverified, signs up and lands signed in; another tab follows", async () => {
      await tab.go("/teams/redbrook-rovers")
      const other = await newTab()
      await other.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
      await other.go("/schedule")
      assert.match(await other.text(), /exploring the demo/)

      await tab.send("Page.bringToFront")
      await tab.click('aside[aria-label="Demo notice"] a[href^="/sign-up"]')
      await tab.until(async () => (await tab.path()) === "/sign-up?next=%2Fteams", "the sign-up page")
      await tab.hydrated()
      const form = await tab.text()
      assert.match(form, /Your email address is not verified\./)
      assert.match(form, /no self-service password reset/)
      await tab.evaluate(`(() => {
        const set = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }
        set(document.querySelector('#sign-up-name'), 'E2E Browser')
        set(document.querySelector('#sign-up-email'), ${JSON.stringify(account.email)})
        set(document.querySelector('#sign-up-password'), ${JSON.stringify(account.password)})
        document.querySelector('form button[type=submit]').click()
      })()`)
      await tab.until(async () => (await tab.path()) === "/teams" && !/exploring the demo/.test(await tab.text()), "the signed-in teams page")
      const text = await tab.text()
      assert.match(text, /Match tracker/)
      assert.match(text, new RegExp(account.email.replace(/[.]/g, "\\.")))
      assert.doesNotMatch(text, /Redbrook Rovers/, "the real catalogue, not the demo")
      assert.ok(!(await tab.hrefs()).some((href) => href?.startsWith("/admin")), "a new account is not an administrator")

      // announceAuthChange(): the other tab, hidden meanwhile, holds the message and refreshes once it is shown.
      // Within the minute a return alone refreshes nothing, so only the sign-up's broadcast can cause this.
      await other.send("Page.bringToFront")
      await other.returnToTab()
      await other.until(async () => !/exploring the demo/.test(await other.text()) && /Match tracker/.test(await other.text()), "the other tab to follow the sign-up", 10_000)
      other.close()
    })

    it("signs out, then signs in again with the new password", async () => {
      await tab.send("Page.bringToFront")
      await tab.go("/dashboard")
      await tab.signOut()
      await tab.signIn(account)
      assert.match(await tab.text(), /Match tracker/)
      await tab.go("/admin")
      assert.match(await tab.text(), /Administrators only/)
      await tab.go("/dashboard")
      await tab.signOut()
    })
  })

  it("the demo fits a phone, with only public tabs and Sign in reachable", async () => {
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    for (const path of ["/", "/sign-in"]) {
      await tab.go(path)
      assert.ok(await tab.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), `${path} overflows`)
    }
    await tab.go("/dashboard")
    assert.ok(await tab.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "/dashboard overflows")
    assert.deepEqual(await tab.evaluate(`[...document.querySelectorAll('nav[aria-label="Mobile navigation"] a')].map((a) => a.getAttribute('href'))`), ["/dashboard", "/schedule", "/matches"])
    assert.ok(await tab.evaluate(`!!document.querySelector('aside[aria-label="Demo notice"] a[href^="/sign-in"]').offsetParent`))
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  })

  it("the error collection works: a blocked inline handler is seen as a CSP violation", async () => {
    await tab.go("/dashboard")
    expectFailure("the deliberately blocked inline handler", /Content Security Policy/)
    await tab.evaluate(`(() => { const el = document.createElement('div'); el.setAttribute('onclick', 'window.__smoke = 1'); document.body.append(el); el.click(); el.remove() })()`)
    await tab.until(async () => problems.some((problem) => /Content Security Policy/.test(problem.text)), "the CSP violation to be reported", 3_000)
    assert.equal(await tab.evaluate("window.__smoke === undefined"), true, "the handler must not have run")
  })

  it("no unexpected console errors, exceptions, CSP violations or failed responses", async () => {
    await sleep(300)
    const unexpected = problems.filter((problem) => {
      const match = expected.find((entry) => entry.pattern.test(problem.url && problem.kind === "response" ? problem.url : problem.text) && (entry.status === undefined || entry.status === problem.status))
      if (match) match.seen += 1
      return !match
    })
    assert.deepEqual(unexpected, [])
    assert.deepEqual(expected.map(({ label, seen }) => ({ label, seen })), expected.map(({ label }) => ({ label, seen: 1 })), "each declared failure happens exactly once")
  })
})
