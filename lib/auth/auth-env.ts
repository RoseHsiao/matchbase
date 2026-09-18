import { isFlagEnabled, resolveRuntimeEnvironment, type EnvLike, type RuntimeEnvironment } from "@/lib/env/runtime-environment"

/**
 * Better Auth configuration derived from the environment, kept pure so it
 * can be tested without a server: the secret, the public base URL, the
 * trusted origins and the sign-up policy.
 */

export const MIN_AUTH_SECRET_LENGTH = 32

export type AuthEnvConfig = {
  secret: string
  /** Undefined only in local development, where Better Auth infers it from the request. */
  baseURL: string | undefined
  trustedOrigins: string[]
  allowSignUp: boolean
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

/**
 * Launch policy (Phase 9.2): public sign-up is CLOSED outside local
 * development unless AUTH_ALLOW_SIGN_UP=true is set explicitly. There is no
 * mail transport, so an account created in Production could not verify its
 * address or recover its password; the operator creates accounts instead
 * (docs/security/production-hardening.md). Development keeps sign-up open
 * so the normal form stays exercised. Safe to call without the secret.
 */
export function isSignUpAllowed(env: EnvLike): boolean {
  const explicit = env.AUTH_ALLOW_SIGN_UP?.trim()
  if (explicit !== undefined && explicit !== "") return isFlagEnabled(explicit)
  return resolveRuntimeEnvironment(env) === "development"
}

export type SignUpPolicy = { open: true; explicit: boolean } | { open: false; reason: string }

export function signUpPolicy(env: EnvLike): SignUpPolicy {
  if (isSignUpAllowed(env)) return { open: true, explicit: env.AUTH_ALLOW_SIGN_UP !== undefined }
  return { open: false, reason: "Account creation is not open on this deployment. Existing accounts can sign in; ask the operator for an account." }
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
  // A preview also trusts the production origin so links between them keep working; nothing else is trusted.
  const candidates = [baseURL, environment === "preview" ? withScheme(env.VERCEL_PROJECT_PRODUCTION_URL) : undefined]
  const trustedOrigins = [...new Set(candidates.filter((value): value is string => Boolean(value)))]
  return { secret, baseURL, trustedOrigins, allowSignUp: isSignUpAllowed(env), environment }
}
