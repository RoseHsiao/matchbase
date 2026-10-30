/**
 * What the Watchlist "Email reminders" card offers, as one pure decision so
 * every combination is unit-tested:
 *
 * - `off-unavailable`: email is not available (no transport, or
 *   AUTH_EMAIL_VERIFICATION_ENABLED off) and the user is not opted in: say
 *   so, offer nothing.
 * - `on-not-delivering`: the user is opted in but nothing is being emailed
 *   (email unavailable, or the address is no longer confirmed): say so and
 *   offer only **Turn off**. Opting out must never depend on delivery.
 * - `unconfirmed`: email is available but the address is not confirmed:
 *   offer the confirmation link, not the opt-in.
 * - `off` / `on`: the normal switch.
 */

export type ReminderSettingsState = "off-unavailable" | "on-not-delivering" | "unconfirmed" | "off" | "on"

export function reminderSettingsState(input: { available: boolean; confirmed: boolean; enabled: boolean }): ReminderSettingsState {
  if (input.enabled && (!input.available || !input.confirmed)) return "on-not-delivering"
  if (!input.available) return "off-unavailable"
  if (!input.confirmed) return "unconfirmed"
  return input.enabled ? "on" : "off"
}
