import type { Metadata } from "next";

import { AdminDashboardView } from "@/components/admin/views/admin-dashboard-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin");

export const metadata: Metadata = {
  title: "Admin",
  description: nav.description,
};

export default function AdminPage() {
  return <AdminDashboardView />;
}
