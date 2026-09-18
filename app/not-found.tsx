import Link from "next/link";
import { CompassIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";

/** Root 404: a plain page with no data access, so it renders for every visitor. */
export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <EmptyState
          icon={CompassIcon}
          title="Page not found"
          description="Nothing lives at this address. It may have moved, or the link may be wrong."
          action={
            <Link href="/dashboard" className={buttonVariants({ variant: "default", size: "sm" })}>
              Go to Dashboard
            </Link>
          }
          className="py-12"
        />
      </div>
    </main>
  );
}
