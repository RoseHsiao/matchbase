// Preloaded into an operator-script child process by tests (node --import): replaces the global
// fetch so nothing can reach the network, and records every attempted URL in the file named by
// RECORD_FETCH_TO. Answers like Resend's accept response, so a send that should not happen is
// observable instead of failing somewhere else.
import { appendFileSync } from "node:fs"

const target = process.env.RECORD_FETCH_TO
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (target) appendFileSync(target, `${url}\n`)
  return new Response(JSON.stringify({ id: "00000000-0000-0000-0000-000000000000" }), { status: 200, headers: { "content-type": "application/json" } })
}
