import type { Metadata } from "next";

import { VerifyEmailForm } from "@/components/auth/verify-email-form";

export const metadata: Metadata = {
  title: "Confirm your email",
  description: "Confirm the email address of a MatchBase account.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** The page the verification email links to (`/verify-email#token=…`); the server renders only the shell. */
export default function VerifyEmailPage() {
  return <VerifyEmailForm />;
}
