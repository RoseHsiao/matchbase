import { betterAuth, type BetterAuthPlugin } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"

import { readAuthEnv } from "@/lib/auth/auth-env"
import { USER_ROLES } from "@/lib/auth/authorization"
import { accountPolicy, createVerificationHooks, markEmailVerifiedInRequest } from "@/lib/auth/email-verification"
import { EMAIL_VERIFICATION_TOKEN_TTL_SECONDS, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_RESET_TOKEN_TTL_SECONDS } from "@/lib/auth/password-policy"
import { createRecoveryHooks } from "@/lib/auth/recovery"
import { redactSensitiveText } from "@/lib/data/sync/redaction"
import type { EnvLike } from "@/lib/env/runtime-environment"
import { createMailer } from "@/lib/mail/create-mailer"
import { readMailEnv } from "@/lib/mail/mail-env"
import type { Mailer } from "@/lib/mail/mailer"
import type { PrismaClient } from "@/lib/generated/prisma/client"

/**
 * The Better Auth instance, as a factory so the application binds it to the
 * pooled Prisma client (lib/auth/auth.ts) and the database tests bind it to
 * their own client and environment. Nothing outside lib/auth imports the
 * result: the rest of the application sees a `Viewer` (lib/auth/authorization.ts).
 *
 * Decisions, with the reasons in docs/security/authentication-and-authorization.md:
 * - email and password as the first method (no email or OAuth infrastructure exists yet);
 * - database sessions, no cookie cache, so revocation and role changes apply on the next request;
 * - `role` is a server-owned field (`input: false`): the browser cannot set it at sign-up or update;
 * - sign-up can be closed with AUTH_ALLOW_SIGN_UP=false without touching code;
 * - self-service password recovery exists only when lib/mail/mail-env.ts says it is
 *   available (AUTH_PASSWORD_RESET_ENABLED plus a transport that can deliver); otherwise
 *   no reset hook is configured and Better Auth answers RESET_PASSWORD_DISABLED, the
 *   same answer for every address (docs/security/account-recovery.md);
 * - email verification follows `accountPolicy` (lib/auth/email-verification.ts): required
 *   whenever public sign-up is open and mail can be delivered, otherwise optional, and open
 *   sign-up without deliverable mail is refused outside development;
 * - every log line passes through the same redaction the sync logs use, and email
 *   addresses are masked (Better Auth logs some at info level).
 */

const SESSION_DAYS = 7
const SESSION_REFRESH_DAYS = 1
/** Per IP: ten wrong guesses a minute is plenty for a person and hopeless for a brute force. */
export const RATE_LIMIT_SIGN_IN_PER_MINUTE = 10
export const RATE_LIMIT_SIGN_UP_PER_HOUR = 5

export type CreateAuthOptions = {
  prisma: PrismaClient
  env: EnvLike
  /** Framework plugins the binding adds (the application adds `nextCookies`); tests pass none. */
  plugins?: BetterAuthPlugin[]
  /** The mailer recovery uses; by default the one the environment configures. Tests inject a capture mailer. */
  mailer?: Mailer
  /**
   * Runs mail sends after the response (the application passes Next.js `after`), so an
   * address with an account and one without answer in the same time. Tests omit it and
   * the sends are awaited.
   */
  background?: (task: Promise<unknown>) => void
}

export function createAuth({ prisma, env, plugins = [], mailer, background }: CreateAuthOptions) {
  const config = readAuthEnv(env)
  const scrub = (value: unknown) => (typeof value === "string" ? redactSensitiveText(value, env).replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[A-Za-z]{2,}/g, "[email]") : value)
  const mail = readMailEnv(env)
  const accounts = accountPolicy(env)
  const activeMailer = mail.transport.kind !== "disabled" ? (mailer ?? createMailer(mail, { env })) : null
  const recovery = mail.passwordReset.enabled && activeMailer ? createRecoveryHooks({ mailer: activeMailer, prisma, baseURL: config.baseURL, background }) : null
  const verification = accounts.verificationMail && activeMailer ? createVerificationHooks({ mailer: activeMailer, baseURL: config.baseURL, background }) : null

  return betterAuth({
    appName: "MatchBase",
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      requireEmailVerification: accounts.requireEmailVerification,
      disableSignUp: !accounts.signUpOpen,
      autoSignIn: true,
      ...(recovery
        ? {
            sendResetPassword: recovery.sendResetPassword,
            onPasswordReset: recovery.onPasswordReset,
            resetPasswordTokenExpiresIn: PASSWORD_RESET_TOKEN_TTL_SECONDS,
            // A reset ends every session of the account, including one a thief may hold.
            revokeSessionsOnPasswordReset: true,
          }
        : {}),
    },
    emailVerification: {
      ...(verification ? { sendVerificationEmail: verification.sendVerificationEmail } : {}),
      sendOnSignUp: accounts.requireEmailVerification,
      sendOnSignIn: accounts.requireEmailVerification,
      // A verification link never signs anyone in, so a leaked or replayed one grants no session.
      autoSignInAfterVerification: false,
      expiresIn: EMAIL_VERIFICATION_TOKEN_TTL_SECONDS,
      afterEmailVerification: async () => markEmailVerifiedInRequest(),
    },
    // Reset tokens are stored as SHA-256 digests, so a database read does not yield a usable link.
    verification: { storeIdentifier: "hashed" },
    user: {
      additionalFields: {
        role: { type: [...USER_ROLES], required: false, defaultValue: "USER", input: false, returned: true },
      },
    },
    session: {
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      updateAge: SESSION_REFRESH_DAYS * 24 * 60 * 60,
    },
    /**
     * Shared, database-backed rate limiting for the auth endpoints
     * (docs/security/production-hardening.md, "Rate limiting"): every
     * serverless instance reads and writes the same RateLimit table, so a
     * limit means the same thing across instances. Keys are IP + path;
     * Better Auth expires rows itself. Off in development so tests and
     * local browser runs never trip it. Only auth HTTP endpoints are
     * limited; server-side `auth.api` calls (dev quick sign-in, tests)
     * bypass the limiter by design.
     */
    rateLimit: {
      enabled: config.environment !== "development",
      storage: "database",
      modelName: "rateLimit",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: RATE_LIMIT_SIGN_IN_PER_MINUTE },
        "/sign-up/email": { window: 3600, max: RATE_LIMIT_SIGN_UP_PER_HOUR },
        "/request-password-reset": { window: 3600, max: RATE_LIMIT_SIGN_UP_PER_HOUR },
        "/change-password": { window: 600, max: 5 },
        "/send-verification-email": { window: 3600, max: RATE_LIMIT_SIGN_UP_PER_HOUR },
        "/verify-email": { window: 600, max: 10 },
      },
    },
    ...(background ? { advanced: { backgroundTasks: { handler: (task: Promise<unknown>) => background(task) } } } : {}),
    plugins,
    logger: {
      level: "warn",
      log(level, message, ...args) {
        const line = `[auth] ${scrub(message)}`
        const rest = args.map(scrub)
        if (level === "error") console.error(line, ...rest)
        else if (level === "warn") console.warn(line, ...rest)
        else console.info(line, ...rest)
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
