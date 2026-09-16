import "server-only"

import { syncRepository } from "@/lib/data/repositories/sync-repository"
import { runSync, type SyncOptions } from "@/lib/data/sync/sync-core"
import type { SyncResult } from "@/lib/data/sync/types"

/**
 * The application's entry point for one synchronisation run, bound to the
 * pooled Prisma client. The pipeline itself lives in sync-core.ts so the
 * database tests can run it inside a transaction they roll back.
 */
export type { SyncOptions }

export function syncDataSource(dataSourceId: string, options: SyncOptions = {}): Promise<SyncResult> {
  return runSync(syncRepository, dataSourceId, options)
}
