import { systemDataSources, systemSports } from "@/lib/data/system-bootstrap"
import type { Prisma } from "@/lib/generated/prisma/client"

/**
 * Idempotent writes for the system bootstrap rows, against an injected
 * client so the database tests run them inside a rolled-back transaction
 * and the operator script runs them for real.
 *
 * Sports: created or updated to the registry (name, category, home/away,
 * order); `status` is left to the administrator once a row exists.
 * Data sources: created ACTIVE; on later runs only the name and sport are
 * refreshed, so an administrator's decision to disable a source, and the
 * source's `lastSyncedAt`, survive.
 */

export type BootstrapClient = Pick<Prisma.TransactionClient, "sport" | "dataSource">

export type BootstrapSummary = { sports: { created: number; updated: number }; dataSources: { created: number; updated: number } }

export async function applySystemBootstrap(db: BootstrapClient, options: { includeMock?: boolean } = {}): Promise<BootstrapSummary> {
  const summary: BootstrapSummary = { sports: { created: 0, updated: 0 }, dataSources: { created: 0, updated: 0 } }
  for (const sport of systemSports()) {
    const existing = await db.sport.findUnique({ where: { id: sport.id }, select: { id: true } })
    const data = { category: sport.category === "esports" ? ("ESPORTS" as const) : ("SPORTS" as const), name: sport.name, homeAway: sport.homeAway, sortOrder: sport.sortOrder }
    await db.sport.upsert({ where: { id: sport.id }, create: { id: sport.id, ...data, status: "ACTIVE" }, update: data })
    if (existing) summary.sports.updated++
    else summary.sports.created++
  }
  for (const source of systemDataSources(options)) {
    const existing = await db.dataSource.findUnique({ where: { id: source.id }, select: { id: true } })
    await db.dataSource.upsert({
      where: { id: source.id },
      create: { id: source.id, name: source.name, sportId: source.sportId, status: "ACTIVE" },
      update: { name: source.name, sportId: source.sportId },
    })
    if (existing) summary.dataSources.updated++
    else summary.dataSources.created++
  }
  return summary
}
