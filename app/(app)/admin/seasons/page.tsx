import type { Metadata } from "next";

import { AdminSeasonsView } from "@/components/admin/views/admin-seasons-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin/seasons");

export const metadata: Metadata = {
  title: `Admin · ${nav.title}`,
  description: nav.description,
};

export default function Page() {
  return <AdminSeasonsView />;
}
