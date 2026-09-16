import "server-only"

import { db } from "@/lib/data/db"
import { createSyncRepository } from "@/lib/data/repositories/sync-ops"

/** The application's sync writes, bound to the pooled Prisma client. Logic lives in sync-ops.ts. */
export const syncRepository = createSyncRepository(db)
