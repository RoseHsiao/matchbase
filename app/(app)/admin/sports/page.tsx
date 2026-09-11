import type { Metadata } from "next";

import { AdminSportsView } from "@/components/admin/views/admin-sports-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin/sports");

export const metadata: Metadata = {
  title: `Admin · ${nav.title}`,
  description: nav.description,
};

export default function Page() {
  return <AdminSportsView />;
}
