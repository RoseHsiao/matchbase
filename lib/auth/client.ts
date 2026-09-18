import { createAuthClient } from "better-auth/react"

/**
 * Browser client for the auth endpoints mounted at /api/auth. Same origin,
 * so no base URL is needed. Only the sign-in, sign-up and sign-out calls are
 * used; who the viewer is comes from the server through ViewerProvider, never
 * from client-side session state.
 */
export const authClient = createAuthClient()

/** Shape of a failed auth call, as the client exposes it. */
export type AuthClientError = { code?: string; message?: string; status?: number }

/** Messages safe to show for the failures a form can meet; anything else is generic. */
export function describeAuthError(error: AuthClientError | null | undefined): string {
  switch (error?.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
    case "USER_NOT_FOUND":
      return "Email or password is incorrect."
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with this email already exists. Sign in instead."
    case "PASSWORD_TOO_SHORT":
      return "Choose a longer password."
    case "PASSWORD_TOO_LONG":
      return "That password is too long."
    case "INVALID_EMAIL":
      return "Enter a valid email address."
    case "SIGNUP_DISABLED":
    case "EMAIL_PASSWORD_SIGN_UP_DISABLED":
      return "Sign-up is closed on this deployment."
    default:
      if (error?.status === 429) return "Too many attempts. Wait a moment and try again."
      return "Something went wrong. Please try again."
  }
}
