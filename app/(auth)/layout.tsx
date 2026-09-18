import Link from "next/link";
import { TrophyIcon } from "lucide-react";

import { ThemeToggle } from "@/components/theme/theme-toggle";

/** Minimal shell for the sign-in and sign-up pages: no sidebar, no personal stores. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <TrophyIcon className="size-4" />
          </span>
          MatchBase
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
