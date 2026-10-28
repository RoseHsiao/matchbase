import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { handleCronNotifications } from "../../lib/api/cron-notifications"
import type { DeliverySummary } from "../../lib/notifications/delivery"

const SECRET = "cron-secret-0123456789abcdef"
const summary: DeliverySummary = { planned: 1, expired: 0, claimed: 1, sent: 1, retry: 0, failed: 0, suppressed: 0, skipped: 0, capReached: false }
const request = (auth?: string) => new Request("https://matchbase.example/api/cron/notifications", { headers: auth ? { authorization: auth } : {} })

describe("notification cron route", () => {
  it("refuses without a configured secret and with a wrong one, before doing anything", async () => {
    let ran = false
    const run = async () => ((ran = true), summary)
    assert.equal((await handleCronNotifications(request(`Bearer ${SECRET}`), { env: {}, mailDeliverable: true, run })).status, 503)
    assert.equal((await handleCronNotifications(request(), { env: { CRON_SECRET: SECRET }, mailDeliverable: true, run })).status, 401)
    assert.equal((await handleCronNotifications(request("Bearer wrong-secret-value-000"), { env: { CRON_SECRET: SECRET }, mailDeliverable: true, run })).status, 401)
    assert.equal(ran, false)
  })

  it("does not plan anything when mail cannot be delivered", async () => {
    let ran = false
    const response = await handleCronNotifications(request(`Bearer ${SECRET}`), { env: { CRON_SECRET: SECRET }, mailDeliverable: false, run: async () => ((ran = true), summary) })
    assert.deepEqual(await response.json(), { ok: true, skipped: "mail-disabled" })
    assert.equal(ran, false)
  })

  it("runs once with the injected clock and returns counts only; a crash answers a fixed message", async () => {
    const now = new Date("2026-11-01T11:15:00.000Z")
    let seen: Date | undefined
    const ok = await handleCronNotifications(request(`Bearer ${SECRET}`), { env: { CRON_SECRET: SECRET }, mailDeliverable: true, now: () => now, run: async (n) => ((seen = n), summary) })
    assert.equal(ok.headers.get("cache-control"), "no-store")
    assert.deepEqual(await ok.json(), { ok: true, ...summary })
    assert.equal(seen, now)
    const original = console.error
    console.error = () => {}
    try {
      const crash = await handleCronNotifications(request(`Bearer ${SECRET}`), { env: { CRON_SECRET: SECRET }, mailDeliverable: true, run: async () => Promise.reject(new Error("db exploded for fan@example.com")) })
      assert.equal(crash.status, 500)
      assert.ok(!(await crash.text()).includes("fan@example.com"))
    } finally {
      console.error = original
    }
  })
})
