import type { Metadata } from "next";

import { getNavItem } from "@/lib/navigation";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

const nav = getNavItem("/matches");

export const metadata: Metadata = {
  title: nav.title,
  description: nav.description,
};

export default function MatchesPage() {
  return <PlaceholderPage href={nav.href} />;
}
