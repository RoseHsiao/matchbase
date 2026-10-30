/**
 * Test-only mutual exclusion for database tests that rewrite the shared demo catalogue inside
 * rolled-back transactions. Test files run in parallel. tests/db/sync-pipeline.test.ts syncs
 * `ds-mock-basketball` (locks its DataSource row FOR UPDATE, then updates its leagues), while
 * tests/db/system-bootstrap.test.ts detaches those leagues and deletes that DataSource row. The
 * two take the same row locks in opposite order and can deadlock: PostgreSQL aborts one
 * transaction (Prisma P2034), runSync records it as an issue and continues, and the next
 * statement fails with 25P02. Reproduced deterministically on 2026-10-28.
 *
 * Calling this first in each such transaction takes one transaction-level advisory lock, held
 * until the rollback, so those transactions run one at a time instead of interleaving.
 */

const SHARED_CATALOGUE_TEST_LOCK = 7_423_100_042

export async function lockSharedCatalogue(tx: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number> }): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SHARED_CATALOGUE_TEST_LOCK}::bigint)`
}
