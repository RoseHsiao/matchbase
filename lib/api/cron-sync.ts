import { createHash, timingSafeEqual } from "node:crypto"

import type { ScheduledSyncSummary, ScheduleTrigger } from "@/lib/data/sync/scheduler"
import { providerSyncPolicy } from "@/lib/env/runtime-environment"

/**
 * The cron trigger boundary: authenticate the request the way Vercel
 * documents (an `Authorization: Bearer <CRON_SECRET>` header), invoke the
 * provider-neutral scheduler, return its summary. Nothing provider-specific
 * lives here, and nothing Vercel-specific leaves here: the scheduler is
 * injected so this handler is tested with plain `Request` objects.
 */

export type CronAuth = { ok: true } | { ok: false; status: 401 | 503; reason: string }

/** Constant-time comparison of two strings regardless of length, via fixed-size digests. */
function sameSecret(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest()
  const db = createHash("sha256").update(b).digest()
  return timingSafeEqual(da, db)
}

export function authorizeCronRequest(request: Request, env: Record<string, string | undefined>): CronAuth {
  const secret = env.CRON_SECRET?.trim()
  // Without a configured secret the route must never run: an open sync endpoint is worse than no cron.
  if (!secret || secret.length < 16) return { ok: false, status: 503, reason: "CRON_SECRET is not configured (at least 16 characters)." }
  const header = request.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match || !sameSecret(match[1].trim(), secret)) return { ok: false, status: 401, reason: "Unauthorized." }
  return { ok: true }
}

export type CronSyncDeps = {
  env: Record<string, string | undefined>
  run: (trigger: ScheduleTrigger, now: Date) => Promise<ScheduledSyncSummary>
  now?: () => Date
}

/** Vercel sends `vercel-cron/1.0`; anything else authorised with the secret is a manual trigger (local smoke test). */
function triggerOf(request: Request): ScheduleTrigger {
  return /^vercel-cron\//i.test(request.headers.get("user-agent") ?? "") ? "cron" : "manual"
}

export async function handleCronSync(request: Request, deps: CronSyncDeps): Promise<Response> {
  const auth = authorizeCronRequest(request, deps.env)
  if (!auth.ok) return Response.json({ ok: false, error: auth.reason }, { status: auth.status, headers: { "cache-control": "no-store" } })
  // Environment intent, after the secret: a Preview deployment never syncs providers unless the operator opted in.
  const policy = providerSyncPolicy(deps.env)
  if (!policy.allowed) return Response.json({ ok: false, error: policy.reason }, { status: 403, headers: { "cache-control": "no-store" } })
  const now = deps.now?.() ?? new Date()
  try {
    const summary = await deps.run(triggerOf(request), now)
    return Response.json({ ok: true, ...summary }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    // The scheduler isolates per-source failures; reaching here means the orchestration itself broke.
    console.error("Scheduled sync failed before it could summarise.", error)
    return Response.json({ ok: false, error: "Scheduled sync failed unexpectedly; see server logs." }, { status: 500, headers: { "cache-control": "no-store" } })
  }
}
