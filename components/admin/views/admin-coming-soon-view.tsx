import { AdminPage } from "@/components/admin/admin-page"
import { EmptyState } from "@/components/empty-state"
import type { AdminNavItem } from "@/lib/admin/navigation"

/** Placeholder body for reserved admin sections that are not built yet. */
export function AdminComingSoonView({ item }: { item: AdminNavItem }) {
  return (
    <AdminPage title={item.title} description={item.description}>
      <EmptyState
        icon={item.icon}
        title="Coming soon"
        description={`${item.title} is reserved in the admin workspace and will be built in a later phase.`}
        className="py-16"
      />
    </AdminPage>
  )
}
