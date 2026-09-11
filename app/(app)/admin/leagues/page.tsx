import type { Metadata } from "next";

import { AdminLeaguesView } from "@/components/admin/views/admin-leagues-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin/leagues");

export const metadata: Metadata = {
  title: `Admin · ${nav.title}`,
  description: nav.description,
};

export default function Page() {
  return <AdminLeaguesView />;
}
