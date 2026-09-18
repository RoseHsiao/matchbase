import { redirect } from "next/navigation";

import { AdminDataProvider } from "@/components/admin/admin-data-provider";
import { AdminForbidden } from "@/components/admin/admin-forbidden";
import { getViewer } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/authorization";
import { signInHref } from "@/lib/auth/redirect";
import { deleteAdminRecord, saveAdminRecord } from "@/lib/data/admin-actions";
import { getAdminData } from "@/lib/data/queries";

/**
 * Gate for every /admin route. An anonymous visitor is sent to sign in and
 * back here; a signed-in non-administrator sees a clear denial; an
 * administrator gets the admin snapshot and the persisting actions. The
 * snapshot loader (`getAdminData`) and the actions check the role again on
 * the server, so this layout is the user experience, not the security boundary.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect(signInHref("/admin"));
  if (!isAdmin(viewer)) return <AdminForbidden />;

  const [initial, now] = [await getAdminData(), new Date().toISOString()];
  return (
    <AdminDataProvider
      initial={initial}
      now={now}
      persist={{ save: saveAdminRecord, remove: deleteAdminRecord }}
    >
      {children}
    </AdminDataProvider>
  );
}
