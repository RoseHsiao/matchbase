import { resolveRuntimeEnvironment, type EnvLike, type RuntimeEnvironment } from "@/lib/env/runtime-environment"

/**
 * Better Auth configuration derived from the environment, kept pure so it
 * can be tested without a server: the secret, the public base URL and the
 * trusted origins. Whether public sign-up is open is decided in exactly one
 * place, `accountPolicy` (lib/auth/email-verification.ts); nothing here
 * answers that question.
 */

export const MIN_AUTH_SECRET_LENGTH = 32

/** Per IP: ten wrong guesses a minute is plenty for a person and hopeless for a brute force. */
export const RATE_LIMIT_SIGN_IN_PER_MINUTE = 10
/** Per IP per hour; also bounds how fast one address can probe sign-up for existing accounts. */
export const RATE_LIMIT_SIGN_UP_PER_HOUR = 5

export type AuthEnvConfig = {
  secret: string
  /** Undefined only in local development, where Better Auth infers it from the request. */
  baseURL: string | undefined
  trustedOrigins: string[]
  environment: RuntimeEnvironment
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthConfigError"
  }
}

function withScheme(host: string | undefined): string | undefined {
  const value = host?.trim()
  if (!value) return undefined
  return (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/+$/, "")
}

/**
 * The URL users reach the app at. Explicit `BETTER_AUTH_URL` wins. On Vercel
 * production it is the project's production domain, on a preview the
 * deployment URL (both provided by the platform, verified 2026-09-17).
 * Locally it stays undefined so the same `.env.local` serves any port.
 */
export function resolveAuthBaseUrl(env: EnvLike): string | undefined {
  const explicit = withScheme(env.BETTER_AUTH_URL)
  if (explicit) return explicit
  const environment = resolveRuntimeEnvironment(env)
  if (environment === "production") return withScheme(env.VERCEL_PROJECT_PRODUCTION_URL)
  if (environment === "preview") return withScheme(env.VERCEL_URL) ?? withScheme(env.VERCEL_BRANCH_URL)
  return undefined
}

export function readAuthEnv(env: EnvLike): AuthEnvConfig {
  const environment = resolveRuntimeEnvironment(env)
  const secret = env.BETTER_AUTH_SECRET?.trim() ?? ""
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new AuthConfigError(`BETTER_AUTH_SECRET must be a random value of at least ${MIN_AUTH_SECRET_LENGTH} characters (openssl rand -base64 32).`)
  }
  const baseURL = resolveAuthBaseUrl(env)
  if (environment !== "development" && !baseURL) {
    throw new AuthConfigError("BETTER_AUTH_URL is not set and no Vercel deployment URL is available; the auth base URL must be explicit outside local development.")
  }
  // A preview deployment answers on two generated hosts (the deployment URL and the git-branch URL) and also
  // trusts the production origin so links between them keep working; nothing else is trusted, never a wildcard.
  const candidates = [
    baseURL,
    environment === "preview" ? withScheme(env.VERCEL_URL) : undefined,
    environment === "preview" ? withScheme(env.VERCEL_BRANCH_URL) : undefined,
    environment === "preview" ? withScheme(env.VERCEL_PROJECT_PRODUCTION_URL) : undefined,
  ]
  const trustedOrigins = [...new Set(candidates.filter((value): value is string => Boolean(value)))]
  return { secret, baseURL, trustedOrigins, environment }
}
