import "server-only"

import { db } from "@/lib/data/db"
import { createSyncRepository } from "@/lib/data/repositories/sync-ops"

/** The application's sync writes, bound to the pooled Prisma client. Logic lives in sync-ops.ts; lock acquisition runs in a short transaction. */
export const syncRepository = createSyncRepository(db, { transaction: (work) => db.$transaction((tx) => work(tx), { timeout: 15_000 }) })
