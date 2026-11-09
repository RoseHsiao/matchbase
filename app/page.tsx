import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/layout/brand-mark";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  LayersIcon,
  SwordsIcon,
  type LucideIcon,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getViewer } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: { absolute: "MatchBase" },
  description:
    "Explore a public demo of MatchBase, a match tracker for sports and esports.",
};

const HIGHLIGHTS: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: LayersIcon,
    title: "Sports and esports",
    description:
      "Football, basketball, tennis, League of Legends, Valorant and CS2, organised by league.",
  },
  {
    icon: CalendarDaysIcon,
    title: "Schedule and live status",
    description:
      "What is on today, what is live, and the week ahead, in one timeline.",
  },
  {
    icon: SwordsIcon,
    title: "Match, team and player pages",
    description:
      "Scoreboards, rosters, fixtures and results, all linked together.",
  },
];

/** Public entry point. A signed-in viewer has no use for it and goes straight to their dashboard. */
export default async function HomePage() {
  if (await getViewer()) redirect("/dashboard");

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground dark:bg-secondary">
            <BrandMark />
          </span>
          MatchBase
        </span>
        <div className="flex items-center gap-1">
          <Link
            href="/sign-in"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Sign in
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-10 px-4 py-12 sm:px-6">
        <section className="grid gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Every match you follow, across sports and esports
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            MatchBase brings schedules, live status, results, teams and players
            into one place. Explore the demo without an account; it is
            read-only, and its teams, players and results are fictional.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
              Explore Demo
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
            <Link
              href="/sign-in"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              Sign in
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Accounts are limited to authorized users. Any resemblance between
            demo data and real teams or people is coincidental.
          </p>
        </section>
        <section
          aria-label="What the demo shows"
          className="grid gap-4 sm:grid-cols-3"
        >
          {HIGHLIGHTS.map((highlight) => (
            <Card key={highlight.title}>
              <CardHeader>
                <highlight.icon
                  className="size-5 text-muted-foreground"
                  aria-hidden
                />
                <CardTitle className="text-sm">{highlight.title}</CardTitle>
                <CardDescription>{highlight.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}
