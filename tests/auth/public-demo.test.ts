import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime"
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime"
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { LandingAccountActions } from "../../components/auth/landing-account-actions"
import { ViewerProvider } from "../../components/auth/viewer-provider"
import { AppHeader } from "../../components/layout/app-header"
import { AppSidebar } from "../../components/layout/app-sidebar"
import { DemoBanner } from "../../components/layout/demo-banner"
import { MobileNav } from "../../components/layout/mobile-nav"
import { readableTextColor, TeamLogo } from "../../components/matches/team-logo"
import { SidebarProvider } from "../../components/ui/sidebar"
import { WatchlistProvider } from "../../components/watchlist/watchlist-provider"
import { WatchlistRemindersProvider } from "../../components/watchlist/watchlist-reminders-provider"
import { TooltipProvider } from "../../components/ui/tooltip"
import type { Viewer } from "../../lib/auth/authorization"
import { accountPolicy } from "../../lib/auth/email-verification"
import { demoTeams } from "../../lib/data/demo-fixtures"
import { signInHrefFromDemo, signUpHref, signUpHrefFromDemo } from "../../lib/auth/redirect"
import { mobileNavItemsFor, navSectionsFor } from "../../lib/navigation"

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) => /\.tsx?$/.test(name)).map((name) => join(dir, name))
}

const member: Viewer = { id: "u-1", email: "user@example.test", name: "Member", role: "USER" }
const admin: Viewer = { id: "u-2", email: "admin@example.test", name: "Admin", role: "ADMIN" }

const stores = { initialIds: [], initialEntries: [], persist: async () => {}, readOnly: false }

function hrefs(viewer: Viewer | null): string[] {
  return navSectionsFor(viewer).flatMap((section) => section.items.map((item) => item.href))
}

function render(viewer: Viewer | null, element: ReactNode, pathname = "/dashboard", signUpOpen = false): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: {} as AppRouterInstance },
      createElement(PathnameContext.Provider, { value: pathname },
        createElement(ViewerProvider, { viewer, signUpOpen } as Parameters<typeof ViewerProvider>[0],
          createElement(WatchlistProvider, stores as unknown as Parameters<typeof WatchlistProvider>[0],
            createElement(WatchlistRemindersProvider, stores as unknown as Parameters<typeof WatchlistRemindersProvider>[0],
              createElement(TooltipProvider, null, createElement(SidebarProvider, null, element)))))))
  )
}

describe("brand mark", () => {
  const BADGE = "flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground dark:bg-secondary"

  it("the 24px logo sits directly inside the 32px badge, dark in light mode and dark:bg-secondary in dark mode", () => {
    const sidebar = render(null, createElement(AppSidebar))
    const badge = new RegExp(`<div class="${BADGE}">(.*?)</div>`).exec(sidebar)
    assert.ok(badge, "the sidebar badge has the expected classes")
    assert.match(badge[1], /^<img[^>]*alt=""/, "the image sits directly inside it, with no other container")
    assert.match(badge[1], /brand%2Fmatchbase\.png|brand\/matchbase\.png/)
    assert.match(badge[1], /width="24" height="24"/)
    assert.match(badge[1], /class="size-6 object-contain"/)
    assert.match(sidebar, />MatchBase</, "the wordmark stays")
  })

  it("every branded header uses the same badge, and none still draws the trophy icon", () => {
    for (const file of ["components/layout/app-sidebar.tsx", "app/(auth)/layout.tsx", "app/page.tsx"]) {
      const source = readFileSync(file, "utf8")
      assert.match(source, /className="flex size-8 (shrink-0 )?items-center justify-center rounded-lg bg-primary text-primary-foreground dark:bg-secondary">\s*<BrandMark \/>/, file)
      assert.doesNotMatch(source, /TrophyIcon/, file)
    }
  })

  it("the component and its image agree: 24px requested, 24px rendered", () => {
    const source = readFileSync("components/layout/brand-mark.tsx", "utf8")
    assert.match(source, /width=\{24\}/)
    assert.match(source, /height=\{24\}/)
    assert.match(source, /className="size-6 object-contain"/)
  })
})

describe("navigation per audience", () => {
  it("a demo visitor sees only public destinations", () => {
    assert.deepEqual(hrefs(null), ["/dashboard", "/schedule", "/matches", "/teams", "/players", "/history"])
    assert.deepEqual(mobileNavItemsFor(null).map((item) => item.href), ["/dashboard", "/schedule", "/matches"])
  })

  it("a member gets the watchlist, and only an administrator gets Admin", () => {
    assert.ok(hrefs(member).includes("/watchlist"))
    assert.ok(!hrefs(member).includes("/admin"))
    assert.ok(hrefs(admin).includes("/admin"))
    assert.equal(mobileNavItemsFor(member).length, 4)
  })
})

describe("rendered shell", () => {
  it("the demo shell says it is a demo, offers sign in, and shows no account controls", () => {
    const sidebar = render(null, createElement(AppSidebar))
    assert.match(sidebar, /Public demo/)
    assert.match(sidebar, /href="\/sign-in"/)
    assert.doesNotMatch(sidebar, /href="\/watchlist"|href="\/admin"|Sign out/)

    const banner = render(null, createElement(DemoBanner))
    assert.match(banner, /exploring the demo/)
    assert.match(banner, /not signed in/)
    assert.match(banner, /fictional/)

    const header = render(null, createElement(AppHeader))
    assert.match(header, />Demo</)
    assert.doesNotMatch(header, /Reminders/)

    assert.doesNotMatch(render(null, createElement(MobileNav)), /href="\/watchlist"/)
  })

  it("the signed-in shell has no demo markers and keeps its account links", () => {
    const sidebar = render(member, createElement(AppSidebar))
    assert.match(sidebar, /Match tracker/)
    assert.match(sidebar, /href="\/watchlist"/)
    assert.doesNotMatch(sidebar, /Public demo|href="\/admin"/)
    assert.match(render(admin, createElement(AppSidebar)), /href="\/admin"/)

    assert.doesNotMatch(render(member, createElement(DemoBanner)), /exploring the demo/)
    const header = render(member, createElement(AppHeader))
    assert.doesNotMatch(header, />Demo</)
    assert.match(header, /Reminders/)
    assert.match(render(member, createElement(MobileNav)), /href="\/watchlist"/)
  })
})

describe("team badge", () => {
  const team = { name: "Team", code: "TEA", color: "#112233" }
  const sizes = ["xs", "sm", "default", "lg", "xl"] as const

  it("a team with no secondary colour renders exactly as it did: background and text only", () => {
    const markup = renderToStaticMarkup(createElement(TeamLogo, { team }))
    assert.match(markup, /style="background-color:#112233;color:#ffffff"/)
    assert.doesNotMatch(markup, /box-shadow/)
  })

  it("a secondary colour adds only a thin inner ring, and changes nothing else", () => {
    for (const size of sizes) {
      const plain = renderToStaticMarkup(createElement(TeamLogo, { team, size }))
      const ringed = renderToStaticMarkup(createElement(TeamLogo, { team: { ...team, secondaryColor: "#445566" }, size }))
      assert.match(ringed, /box-shadow:inset 0 0 0 1\.5px #445566/, size)
      assert.equal(ringed.replace(/;box-shadow:[^"]+/, ""), plain, `${size}: same box, classes and text`)
    }
  })

  // Rec. 709 relative luminance and the WCAG contrast ratio.
  const channels = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
  const luminance = (hex: string) => {
    const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: string, b: string) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (light + 0.05) / (dark + 0.05)
  }
  /** `--card` in app/globals.css, oklch(1 0 0) and oklch(0.205 0 0): the surface badges sit on, in each theme. */
  const CARD = { light: "#ffffff", dark: "#171717" }

  it("every demo badge's code is readable: at least 4.5:1 on its primary colour", () => {
    for (const { name, color } of demoTeams) {
      const ratio = contrast(color, readableTextColor(color))
      assert.ok(ratio >= 4.5, `${name}: ${ratio.toFixed(2)}:1`)
    }
  })

  it("every demo badge stands out on both themes through its fill or its ring: at least 3:1", () => {
    for (const { name, color, secondaryColor } of demoTeams) {
      for (const [theme, surface] of Object.entries(CARD)) {
        const best = Math.max(contrast(color, surface), contrast(secondaryColor ?? color, surface))
        assert.ok(best >= 3, `${name} on ${theme}: ${best.toFixed(2)}:1`)
      }
    }
  })

  it("every demo ring can be seen against its own fill", () => {
    for (const { name, color, secondaryColor } of demoTeams) assert.ok(contrast(color, secondaryColor ?? color) >= 2, name)
  })

  it("no demo ring reads as a status: nothing saturated in the red or green the app uses for state", () => {
    const hsl = (hex: string) => {
      const [r, g, b] = channels(hex)
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const delta = max - min
      const lightness = (max + min) / 2
      const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
      const hue = delta === 0 ? 0 : max === r ? ((((g - b) / delta) % 6) + 6) % 6 * 60 : max === g ? ((b - r) / delta + 2) * 60 : ((r - g) / delta + 4) * 60
      return { hue, saturation, lightness }
    }
    for (const { name, secondaryColor } of demoTeams) {
      const { hue, saturation, lightness } = hsl(secondaryColor ?? "#808080")
      const redOrGreen = hue >= 345 || hue < 15 || (hue >= 90 && hue <= 150)
      assert.ok(!(redOrGreen && saturation >= 0.5 && lightness >= 0.2 && lightness <= 0.85), `${name}: ${secondaryColor}`)
    }
  })
})

describe("signing in from the demo", () => {
  it("returns to the same page, or to a list when the page is a demo record", () => {
    assert.equal(signInHrefFromDemo("/dashboard"), "/sign-in")
    assert.equal(signInHrefFromDemo("/schedule"), "/sign-in?next=%2Fschedule")
    assert.equal(signInHrefFromDemo("/matches"), "/sign-in?next=%2Fmatches")
    assert.equal(signInHrefFromDemo("/matches/demo-match-1"), "/sign-in?next=%2Fmatches")
    assert.equal(signInHrefFromDemo("/teams/redbrook-rovers"), "/sign-in?next=%2Fteams")
    assert.equal(signInHrefFromDemo("/players/theo-ashgrove"), "/sign-in?next=%2Fplayers")
    assert.equal(signInHrefFromDemo("/leagues/meridian-league"), "/sign-in")
  })
})

describe("session refresh cannot poll", () => {
  it("uses no timer: it only reacts to a session change or to the tab regaining focus", () => {
    const source = readFileSync("components/auth/session-sync.tsx", "utf8")
    assert.doesNotMatch(source, /setInterval|setTimeout|requestAnimationFrame|fetch\(/)
    assert.match(source, /FOCUS_REFRESH_INTERVAL_MS = 60_000/)
  })
})

describe("public sign-up follows the account policy", () => {
  it("stays closed on Production and Preview unless an operator sets both flags", () => {
    for (const VERCEL_ENV of ["production", "preview"]) {
      assert.equal(accountPolicy({ VERCEL_ENV }).signUpOpen, false)
      assert.equal(accountPolicy({ VERCEL_ENV, AUTH_ALLOW_SIGN_UP: "true" }).signUpOpen, false, "one flag is not enough")
      assert.equal(accountPolicy({ VERCEL_ENV, AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }).signUpOpen, false, "one flag is not enough")
      assert.equal(accountPolicy({ VERCEL_ENV, AUTH_ALLOW_SIGN_UP: "true", AUTH_ALLOW_UNVERIFIED_SIGN_UP: "true" }).signUpOpen, true)
    }
  })

  it("the landing page reads the policy on the server and hands it to its actions", () => {
    const landing = readFileSync("app/page.tsx", "utf8")
    assert.match(landing, /<LandingAccountActions\s+signUpOpen=\{accountPolicy\(process\.env\)\.signUpOpen\}/)
    assert.doesNotMatch(landing, /href="\/sign-up"/, "no hard-coded sign-up link outside the policy-driven component")
  })

  it("landing, closed: Explore Demo and Sign in, the authorized-users note, no Create account", () => {
    const html = renderToStaticMarkup(createElement(LandingAccountActions, { signUpOpen: false }))
    assert.match(html, /Explore Demo/)
    assert.match(html, /href="\/sign-in"/)
    assert.match(html, /limited to authorized users/)
    assert.doesNotMatch(html, /sign-up|Create account/)
  })

  it("landing, open: Create account next to Explore Demo and Sign in, and the copy drops 'authorized users'", () => {
    const html = renderToStaticMarkup(createElement(LandingAccountActions, { signUpOpen: true }))
    assert.match(html, /Explore Demo/)
    assert.match(html, /href="\/sign-up"[^>]*>Create account</)
    assert.match(html, /href="\/sign-in"/)
    assert.doesNotMatch(html, /authorized users/)
    assert.match(html, /coincidental/, "the fictional-data note stays")
  })

  it("demo banner and sidebar offer Create account only when sign-up is open", () => {
    const closedBanner = render(null, createElement(DemoBanner), "/matches/demo-match-1")
    assert.doesNotMatch(closedBanner, /sign-up|Create account/)
    assert.match(closedBanner, /href="\/sign-in\?next=%2Fmatches"/)
    const openBanner = render(null, createElement(DemoBanner), "/matches/demo-match-1", true)
    assert.match(openBanner, /href="\/sign-up\?next=%2Fmatches"[^>]*>Create account</, "a demo record returns to its list, as signing in does")
    assert.match(openBanner, /href="\/sign-in\?next=%2Fmatches"/)
    assert.match(openBanner, /exploring the demo/)

    const closedSidebar = render(null, createElement(AppSidebar))
    assert.match(closedSidebar, /For authorized accounts/)
    assert.doesNotMatch(closedSidebar, /href="\/sign-up"|Create account/)
    const openSidebar = render(null, createElement(AppSidebar), "/dashboard", true)
    assert.match(openSidebar, /href="\/sign-up"/)
    assert.match(openSidebar, /Create account/)
    assert.doesNotMatch(openSidebar, /For authorized accounts/)
    assert.match(openSidebar, /Public demo/)
  })

  it("a signed-in viewer sees no sign-up offer even when it is open", () => {
    const banner = render(member, createElement(DemoBanner), "/dashboard", true)
    assert.doesNotMatch(banner, /Demo notice|sign-up|Create account/)
    assert.doesNotMatch(render(member, createElement(AppSidebar), "/dashboard", true), /href="\/sign-up"|Create account/)
  })

  it("sign-up links keep the same safe-next rule as sign-in", () => {
    assert.equal(signUpHref(), "/sign-up")
    assert.equal(signUpHref("/schedule"), "/sign-up?next=%2Fschedule")
    assert.equal(signUpHref("//evil.example"), "/sign-up")
    assert.equal(signUpHrefFromDemo("/dashboard"), "/sign-up")
    assert.equal(signUpHrefFromDemo("/teams/redbrook-rovers"), "/sign-up?next=%2Fteams")
    assert.equal(signUpHrefFromDemo("/leagues/meridian-league"), "/sign-up")
  })
})

describe("admin pages hold no data of their own", () => {
  it("every admin page renders a client view fed by the guarded layout, so skipping the layout yields nothing", () => {
    const pages = readdirSync("app/(app)/admin", { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith("page.tsx"))
    assert.ok(pages.length >= 13)
    for (const name of pages) {
      const source = readFileSync(join("app/(app)/admin", name), "utf8")
      assert.doesNotMatch(source, /lib\/data\/(queries|db|repositories)|lib\/auth\/session|\bawait\b/, name)
    }
  })

  it("the admin repository is reachable only through the guarded loader and the guarded actions", () => {
    const files = [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib").filter((file) => !file.startsWith("lib/generated/"))]
    const importers = files.filter((file) => readFileSync(file, "utf8").includes('from "@/lib/data/repositories/admin-repository"'))
    assert.deepEqual(importers.sort(), ["lib/data/admin-actions.ts", "lib/data/queries.ts"])
    const queries = readFileSync("lib/data/queries.ts", "utf8")
    assert.equal(queries.match(/adminRepository\./g)?.length, 1, "one read of the admin repository")
    assert.match(queries, /export async function getAdminData\(\): Promise<AdminData> \{\n {2}await requireAdmin\(\)\n {2}return adminRepository\.getAll\(\)/)
  })

  it("the Watchlist page guards itself, in the page, not only in a layout", () => {
    assert.match(readFileSync("app/(app)/watchlist/page.tsx", "utf8"), /if \(!viewer\) redirect/)
  })
})

describe("every Server Action checks the session before doing anything", () => {
  const guarded: [string, RegExp][] = [
    ["lib/data/user-state-actions.ts", /requireUser\(\)/],
    ["lib/notifications/actions.ts", /requireUser\(\)/],
    ["lib/data/admin-actions.ts", /denyUnlessAdmin\(\)/],
  ]
  const work = /Repository\.|assertId\(|\bdb\.|runSync|Ops\(|ops\.|update[A-Z]\w*\(/

  for (const [file, guard] of guarded) {
    it(file, () => {
      const parts = readFileSync(file, "utf8").split(/^export async function /m).slice(1)
      assert.ok(parts.length > 0)
      for (const part of parts) {
        const name = part.slice(0, part.indexOf("("))
        const body = part.slice(part.indexOf("{"))
        const guardAt = body.search(guard)
        assert.ok(guardAt >= 0, `${name} has no guard`)
        const workAt = body.search(work)
        assert.ok(workAt === -1 || guardAt < workAt, `${name} works before its guard`)
      }
    })
  }

  it("the only other action is the development quick sign-in, refused by its policy first", () => {
    const body = readFileSync("lib/auth/dev-login-actions.ts", "utf8").split("export async function devQuickSignIn")[1]
    assert.ok(body.indexOf("if (!policy.enabled)") < body.indexOf("getAuth()"))
  })
})
