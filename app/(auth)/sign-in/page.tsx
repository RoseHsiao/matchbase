import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DevQuickLogin } from "@/components/auth/dev-quick-login";
import { SignInForm } from "@/components/auth/sign-in-form";
import { describeDevAccounts, resolveDevLogin } from "@/lib/auth/dev-login";
import { accountPolicy } from "@/lib/auth/email-verification";
import { safeNextPath } from "@/lib/auth/redirect";
import { getViewer } from "@/lib/auth/session";
import { readMailEnv } from "@/lib/mail/mail-env";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to follow teams, save matches and set reminders.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [viewer, params] = await Promise.all([getViewer(), searchParams]);
  const next = safeNextPath(params.next);
  if (viewer) redirect(next);
  // Development only: the policy refuses outside a local development environment.
  const devAccounts = describeDevAccounts(resolveDevLogin(process.env));
  return (
    <div className="grid w-full max-w-sm gap-4">
      <SignInForm next={next} signUpAllowed={accountPolicy(process.env).signUpOpen} recoveryAvailable={readMailEnv(process.env).passwordReset.enabled} />
      {devAccounts.length > 0 ? <DevQuickLogin accounts={devAccounts} next={next} /> : null}
    </div>
  );
}
