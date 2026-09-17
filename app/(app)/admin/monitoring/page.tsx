import type { Metadata } from "next";

import { AdminMonitoringView } from "@/components/admin/views/admin-monitoring-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin/monitoring");

export const metadata: Metadata = {
  title: `Admin · ${nav.title}`,
  description: nav.description,
};

export default function Page() {
  return <AdminMonitoringView />;
}
