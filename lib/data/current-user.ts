import "server-only"

import { DEMO_USER_ID } from "@/lib/data/demo-user"

/**
 * Resolves the id of the user making the current request.
 *
 * There is no authentication yet: every request is the fixed development
 * user created by the seed. This is the only place that knows that, so a
 * later auth phase replaces this function body (reading a session) without
 * touching queries, actions, or repositories. It is async for that reason.
 */
export async function getCurrentUserId(): Promise<string> {
  return DEMO_USER_ID
}
