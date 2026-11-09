import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { buttonVariants } from "@/components/ui/button";

/** Minimal shell for the sign-in and sign-up pages: no sidebar, no personal stores, and a way back to the public demo. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground dark:bg-secondary">
            <BrandMark />
          </span>
          MatchBase
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/dashboard" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Explore demo
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
