import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { PASSWORD_RESET_TOKEN_TTL_SECONDS } from "@/lib/auth/password-policy";
import { getViewer } from "@/lib/auth/session";
import { readMailEnv } from "@/lib/mail/mail-env";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Request a link to choose a new MatchBase password.",
  robots: { index: false, follow: false },
};

/**
 * Request a reset link. Whether the form exists follows the same switch the
 * auth server uses (lib/mail/mail-env.ts), so a deployment without a working
 * transport says so instead of pretending to send.
 */
export default async function ForgotPasswordPage() {
  if (await getViewer()) redirect("/dashboard");
  const available = readMailEnv(process.env).passwordReset.enabled;
  return <ForgotPasswordForm available={available} lifetimeMinutes={Math.round(PASSWORD_RESET_TOKEN_TTL_SECONDS / 60)} />;
}
