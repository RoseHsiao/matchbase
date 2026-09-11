import type { Metadata } from "next";

import { AdminDataSourcesView } from "@/components/admin/views/admin-data-sources-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin/data-sources");

export const metadata: Metadata = {
  title: `Admin · ${nav.title}`,
  description: nav.description,
};

export default function Page() {
  return <AdminDataSourcesView />;
}
