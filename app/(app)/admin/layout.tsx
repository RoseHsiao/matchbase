import { AdminDataProvider } from "@/components/admin/admin-data-provider";
import { getAdminData } from "@/lib/data/queries";

/**
 * Loads every admin collection once and holds it in client state for the
 * session, so list pages, forms, and the dashboard share one source.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [initial, now] = [await getAdminData(), new Date().toISOString()];
  return (
    <AdminDataProvider initial={initial} now={now}>
      {children}
    </AdminDataProvider>
  );
}
