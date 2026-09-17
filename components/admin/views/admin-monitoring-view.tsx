"use client"

import Link from "next/link"
import { ActivityIcon, AlertTriangleIcon, CheckCircle2Icon, ClockIcon, RefreshCwIcon } from "lucide-react"

import { useAdminCollection, useAdminLookups, useAdminNow } from "@/components/admin/admin-data-provider"
import { AdminDataTable, type AdminColumn } from "@/components/admin/admin-data-table"
import { AdminPage } from "@/components/admin/admin-page"
import { AdminStatusBadge } from "@/components/admin/admin-status-badge"
import { useSyncNow } from "@/components/admin/use-sync-now"
import { StatCard } from "@/components/dashboard/stat-card"
import { EmptyState } from "@/components/empty-state"
import { SectionCard } from "@/components/layout/section-card"
import { SportLine } from "@/components/sport-icon"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { healthMeta, runCategoryLabel } from "@/lib/admin/status"
import { freshnessLabel } from "@/lib/data/sync/freshness"
import { ATTENTION_STATES, describeRun, evaluateSourceHealth, summarizeRun, type SourceHealthReport } from "@/lib/data/sync/health"
import { DEFAULT_SCHEDULE_CONFIG } from "@/lib/data/sync/schedule-config"
import type { DataSource } from "@/lib/data/types"
import { formatDateTime, formatDuration, formatRelativeTime } from "@/lib/format"

type SourceRow = { source: DataSource; health: SourceHealthReport }

const RECENT_RUN_ROWS = 12

/**
 * Operational overview: every source's health derived from persisted
 * evidence (lib/data/sync/health.ts) with the snapshot's `now`, a compact
 * summary, and the most recent runs. Recovery uses the same "Sync now"
 * path as Data Sources, so the per-source lock applies here too.
 */
export function AdminMonitoringView() {
  const now = useAdminNow()
  const { items: dataSources } = useAdminCollection("dataSources")
  const { items: syncLogs } = useAdminCollection("syncLogs")
  const { dataSourceById } = useAdminLookups()
  const { sync, syncingId } = useSyncNow()

  const rows: SourceRow[] = dataSources.map((source) => ({
    source,
    health: evaluateSourceHealth({
      enabled: source.status !== "disconnected",
      provider: source.provider ? { kind: source.provider.kind, configured: source.provider.configured, configurationError: source.provider.configurationError } : undefined,
      lastSuccessfulSyncAt: source.lastSyncedAt,
      recentRuns: source.recentRuns ?? [],
      now,
      schedule: DEFAULT_SCHEDULE_CONFIG,
    }),
  }))
  const live = rows.filter((r) => r.source.provider?.kind === "live")
  const healthy = live.filter((r) => r.health.state === "healthy").length
  const attention = live.filter((r) => ATTENTION_STATES.includes(r.health.state)).length
  const syncing = live.filter((r) => r.health.state === "syncing").length
  // Freshness, not health: a failing source whose data has also aged is counted here too.
  const stale = live.filter((r) => r.source.provider?.configured && r.health.freshness.state === "stale").length
  const unconfigured = live.filter((r) => r.health.state === "not-configured").length
  const mocks = rows.filter((r) => r.health.state === "mock").length
  const placeholders = rows.filter((r) => r.health.state === "placeholder").length

  const recent = [...syncLogs]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_RUN_ROWS)
    .map((log) => ({ log, run: summarizeRun({ id: log.id, status: log.status, at: log.at, durationMs: log.durationMs, records: log.records, error: log.error }) }))

  const columns: AdminColumn<SourceRow>[] = [
    {
      key: "source",
      header: "Source",
      cell: ({ source }) => (
        <span className="grid gap-0.5">
          <span className="font-medium">{source.name}</span>
          {source.sport ? <SportLine sport={source.sport} size="xs" className="text-xs text-muted-foreground" /> : <span className="text-xs text-muted-foreground">Cross-discipline</span>}
        </span>
      ),
      sortValue: ({ source }) => source.name,
    },
    {
      key: "provider",
      header: "Provider",
      cell: ({ source }) =>
        source.provider ? (
          <span className="flex items-center gap-1.5">
            <span>{source.provider.name}</span>
            <Badge variant={source.provider.kind === "mock" ? "secondary" : "outline"} className="h-4 px-1.5 text-[10px]">
              {source.provider.kind === "mock" ? "Mock" : "Live"}
            </Badge>
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
      sortValue: ({ source }) => source.provider?.name ?? "",
    },
    {
      key: "health",
      header: "Health",
      cell: ({ health }) => (
        <span className="grid max-w-80 gap-1">
          <AdminStatusBadge meta={healthMeta[health.state]} className="w-fit" />
          <span className="text-xs text-muted-foreground" title={health.reasons.join(" ")}>
            {health.reasons[0]}
          </span>
        </span>
      ),
      sortValue: ({ health }) => (health.needsAttention ? "0" : "1") + health.state,
    },
    {
      key: "freshness",
      header: "Freshness",
      cell: ({ health, source }) => (source.provider ? <span className={health.freshness.state === "stale" ? "text-destructive" : undefined}>{freshnessLabel(health.freshness)}</span> : <span className="text-muted-foreground">—</span>),
      sortValue: ({ health }) => health.freshness.ageMs ?? Number.MAX_SAFE_INTEGER,
      className: "whitespace-nowrap",
    },
    {
      key: "success",
      header: "Last success",
      cell: ({ source }) => (source.lastSyncedAt ? <time dateTime={source.lastSyncedAt}>{formatRelativeTime(source.lastSyncedAt, now)}</time> : <span className="text-muted-foreground">Never</span>),
      sortValue: ({ source }) => source.lastSyncedAt ?? "",
      className: "whitespace-nowrap",
    },
    {
      key: "run",
      header: "Last run",
      cell: ({ health }) =>
        health.latestRun ? (
          <span className="grid gap-0.5">
            <span className="flex items-center gap-1.5">
              <AdminStatusBadge status={health.latestRun.status} />
              <time dateTime={health.latestRun.at} className="text-xs text-muted-foreground">{formatRelativeTime(health.latestRun.at, now)}</time>
            </span>
            <span className="text-xs text-muted-foreground">{describeRun(health.latestRun)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">No runs</span>
        ),
      sortValue: ({ health }) => health.latestRun?.at ?? "",
    },
    { key: "duration", header: "Duration", cell: ({ health }) => (health.latestRun ? formatDuration(health.latestRun.durationMs) : "—"), sortValue: ({ health }) => health.latestRun?.durationMs ?? -1, className: "tabular-nums whitespace-nowrap" },
    { key: "records", header: "Records", cell: ({ health }) => (health.latestRun ? health.latestRun.records : "—"), sortValue: ({ health }) => health.latestRun?.records ?? -1, className: "tabular-nums" },
    {
      key: "auto",
      header: "Auto sync",
      cell: ({ source }) => (source.scheduled ? "Daily" : <span className="text-muted-foreground" title={source.scheduleReason}>Off</span>),
      sortValue: ({ source }) => (source.scheduled ? "1" : "0"),
    },
  ]

  const recentColumns: AdminColumn<(typeof recent)[number]>[] = [
    { key: "at", header: "Started", cell: ({ log }) => <time dateTime={log.at} className="tabular-nums">{formatDateTime(log.at)}</time>, sortValue: ({ log }) => log.at, className: "whitespace-nowrap" },
    { key: "source", header: "Source", cell: ({ log }) => <span className="font-medium">{dataSourceById.get(log.dataSourceId)?.name ?? log.dataSourceId}</span>, sortValue: ({ log }) => dataSourceById.get(log.dataSourceId)?.name ?? "" },
    { key: "status", header: "Outcome", cell: ({ run }) => <AdminStatusBadge status={run.status} />, sortValue: ({ run }) => run.status },
    { key: "kind", header: "Kind", cell: ({ run }) => <span className="text-xs text-muted-foreground">{runCategoryLabel[run.category]}{run.category === "issues" ? ` · ${describeRun(run)}` : ""}</span> },
    { key: "records", header: "Records", cell: ({ run }) => run.records, sortValue: ({ run }) => run.records, className: "tabular-nums" },
    { key: "duration", header: "Duration", cell: ({ run }) => formatDuration(run.durationMs), sortValue: ({ run }) => run.durationMs, className: "tabular-nums whitespace-nowrap" },
  ]

  if (dataSources.length === 0) {
    return (
      <AdminPage title="Monitoring" description="Operational health of external data sources.">
        <EmptyState icon={ActivityIcon} title="No data sources yet" description="Add a data source and bind a provider to see its health here." action={<Link href="/admin/data-sources" className={buttonVariants({ variant: "outline", size: "sm" })}>Open Data Sources</Link>} className="py-16" />
      </AdminPage>
    )
  }

  return (
    <AdminPage
      title="Monitoring"
      description="Operational health of external data sources: derived from each source's configuration, its last successful sync and its recent runs. Nothing here alerts anyone; it answers whether the data is being kept fresh."
    >
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Healthy" value={healthy} hint={live.length === 0 ? "no live providers bound" : `of ${live.length} live ${live.length === 1 ? "source" : "sources"}`} icon={CheckCircle2Icon} />
        <StatCard label="Needs attention" value={attention} hint={attention === 0 ? "nothing to act on" : "failing, stale, degraded or never synced"} icon={AlertTriangleIcon} />
        <StatCard label="Syncing" value={syncing} hint={syncing === 0 ? "no run in progress" : "run in progress"} icon={RefreshCwIcon} />
        <StatCard label="Stale" value={stale} hint={`beyond ${Math.round((DEFAULT_SCHEDULE_CONFIG.expectedIntervalMs + DEFAULT_SCHEDULE_CONFIG.graceMs) / 3_600_000)} h since last success`} icon={ClockIcon} />
      </div>
      {unconfigured + mocks + placeholders > 0 ? (
        <p className="text-sm text-muted-foreground">
          Not counted above: {[unconfigured > 0 ? `${unconfigured} live ${unconfigured === 1 ? "source" : "sources"} not configured` : "", mocks > 0 ? `${mocks} mock ${mocks === 1 ? "feed" : "feeds"}` : "", placeholders > 0 ? `${placeholders} ${placeholders === 1 ? "placeholder" : "placeholders"} without a provider` : ""].filter(Boolean).join(" · ")}.
        </p>
      ) : null}

      <AdminDataTable
        columns={columns}
        rows={rows}
        getRowId={({ source }) => source.id}
        noun="source"
        defaultSort={{ key: "health", direction: "asc" }}
        rowActions={[{ label: syncingId ? "Sync running…" : "Sync now", icon: RefreshCwIcon, onSelect: ({ source }) => void sync(source) }]}
        emptyTitle="No data sources"
      />

      <SectionCard title="Recent runs" description={`The last ${Math.min(RECENT_RUN_ROWS, recent.length)} sync runs across every source`} href="/admin/sync-logs" actionLabel="All sync logs" contentClassName="px-0">
        {recent.length === 0 ? (
          <EmptyState icon={ClockIcon} title="No runs yet" description="Runs appear here after a Sync now or a scheduled sync." className="mx-4" />
        ) : (
          <AdminDataTable columns={recentColumns} rows={recent} getRowId={({ log }) => log.id} noun="run" defaultSort={{ key: "at", direction: "desc" }} pageSize={RECENT_RUN_ROWS} />
        )}
      </SectionCard>
    </AdminPage>
  )
}
