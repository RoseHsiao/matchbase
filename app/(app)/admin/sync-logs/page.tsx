import type { Metadata } from "next";

import { AdminSyncLogsView } from "@/components/admin/views/admin-sync-logs-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin/sync-logs");

export const metadata: Metadata = {
  title: `Admin · ${nav.title}`,
  description: nav.description,
};

export default function Page() {
  return <AdminSyncLogsView />;
}
