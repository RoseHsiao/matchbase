import type { Metadata } from "next";

import { AdminLandingView } from "@/components/admin/views/admin-landing-view";

export const metadata: Metadata = {
  title: "Admin",
  description: "Overview of the catalogue, recent activity, and data health.",
};

/** Admin root: a lightweight landing with counts, activity, and data health. */
export default function AdminPage() {
  return <AdminLandingView />;
}
