import type { Metadata } from "next";

import { AdminPlayersView } from "@/components/admin/views/admin-players-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin/players");

export const metadata: Metadata = {
  title: `Admin · ${nav.title}`,
  description: nav.description,
};

export default function Page() {
  return <AdminPlayersView />;
}
