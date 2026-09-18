import Link from "next/link"
import { ShieldOffIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { buttonVariants } from "@/components/ui/button"

/** Shown to a signed-in user without the ADMIN role on any /admin route. */
export function AdminForbidden() {
  return (
    <>
      <PageHeader title="Admin" description="Catalogue management, data sources and monitoring." />
      <EmptyState
        icon={ShieldOffIcon}
        title="Administrators only"
        description="Your account does not have administrator access. An operator grants it from the command line; nothing in the app can."
        action={
          <Link href="/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Back to Dashboard
          </Link>
        }
        className="py-16"
      />
    </>
  )
}
