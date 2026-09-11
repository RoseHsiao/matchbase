import type { Metadata } from "next";

import { AdminMatchesView } from "@/components/admin/views/admin-matches-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin/matches");

export const metadata: Metadata = {
  title: `Admin · ${nav.title}`,
  description: nav.description,
};

export default function Page() {
  return <AdminMatchesView />;
}
