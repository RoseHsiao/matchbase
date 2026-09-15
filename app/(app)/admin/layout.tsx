import { AdminDataProvider } from "@/components/admin/admin-data-provider";
import { deleteAdminRecord, saveAdminRecord } from "@/lib/data/admin-actions";
import { getAdminData } from "@/lib/data/queries";

/**
 * Loads every admin collection from the database on each render and hands
 * the client store the server actions that persist changes back to it.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
