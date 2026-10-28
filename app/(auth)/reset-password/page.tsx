import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new MatchBase password from a reset link.",
  robots: { index: false, follow: false },
  // The token lives in the fragment, which browsers never send; no-referrer is defence in depth for links on this page.
  referrer: "no-referrer",
};

/**
 * The page the reset email links to (`/reset-password#token=…`). The server
 * renders only the shell: the token is in the fragment, which never reaches
 * the server, and the client form reads it and removes it from the URL.
 * Rendered for signed-in visitors too, since a reset ends every session anyway.
 */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
