import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";

const SIDEBAR_COOKIE_NAME = "sidebar_state";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return <AppShell defaultOpen={defaultOpen}>{children}</AppShell>;
}
