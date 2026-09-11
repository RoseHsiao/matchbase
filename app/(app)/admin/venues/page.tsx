import type { Metadata } from "next";

import { AdminVenuesView } from "@/components/admin/views/admin-venues-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin/venues");

export const metadata: Metadata = {
  title: `Admin · ${nav.title}`,
  description: nav.description,
};

export default function Page() {
  return <AdminVenuesView />;
}
