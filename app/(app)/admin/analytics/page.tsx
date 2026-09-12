import type { Metadata } from "next";

import { AdminComingSoonView } from "@/components/admin/views/admin-coming-soon-view";
import { getAdminNavItem } from "@/lib/admin/navigation";

const nav = getAdminNavItem("/admin/analytics");

export const metadata: Metadata = {
  title: `Admin · ${nav.title}`,
  description: nav.description,
};

export default function Page() {
  return <AdminComingSoonView item={nav} />;
}
