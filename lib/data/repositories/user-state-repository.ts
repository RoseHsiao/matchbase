import "server-only"

import { db } from "@/lib/data/db"
import { createUserStateOps } from "@/lib/data/repositories/user-state-ops"

/**
 * The application's binding of the user-state persistence to the pooled
 * Prisma client. The operations themselves live in user-state-ops.ts so the
 * database tests can run them inside a rolled-back transaction.
 */
export const userStateRepository = createUserStateOps(db)
