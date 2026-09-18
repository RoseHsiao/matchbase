import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignUpForm } from "@/components/auth/sign-up-form";
import { isSignUpAllowed } from "@/lib/auth/auth-env";
import { safeNextPath } from "@/lib/auth/redirect";
import { getViewer } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a MatchBase account to follow teams, save matches and set reminders.",
};

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [viewer, params] = await Promise.all([getViewer(), searchParams]);
  const next = safeNextPath(params.next);
  if (viewer) redirect(next);
  return <SignUpForm next={next} allowed={isSignUpAllowed(process.env)} />;
}
