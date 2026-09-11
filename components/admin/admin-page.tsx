import { PageHeader } from "@/components/layout/page-header"

type AdminPageProps = {
  title: string
  description?: string
  /** Primary action, e.g. an "Add team" button. */
  actions?: React.ReactNode
  children: React.ReactNode
}

/** Shared frame for admin pages: header plus a stacked content area. */
export function AdminPage({ title, description, actions, children }: AdminPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} actions={actions} />
      <div className="grid gap-4">{children}</div>
    </>
  )
}
