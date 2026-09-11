import type { Metadata } from "next";

import { AdminTeamsView } from "@/components/admin/views/admin-teams-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin/teams");

export const metadata: Metadata = {
  title: `Admin · ${nav.title}`,
  description: nav.description,
};

export default function Page() {
  return <AdminTeamsView />;
}
