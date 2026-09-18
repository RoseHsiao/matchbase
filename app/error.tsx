"use client";

import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Route error boundary. In Production Next.js replaces the error message
 * with a digest, so nothing internal can appear here; the digest is shown
 * so a person can quote it to the operator, who finds it in the server log.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <EmptyState
          icon={TriangleAlertIcon}
          title="Something went wrong"
          description={error.digest ? `The page could not be shown. Reference: ${error.digest}` : "The page could not be shown. Please try again."}
          action={
            <span className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={reset}>
                Try again
              </Button>
              <Link href="/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Go to Dashboard
              </Link>
            </span>
          }
          className="py-12"
        />
      </div>
    </main>
  );
}
