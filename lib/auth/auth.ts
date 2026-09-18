import "server-only"

import { nextCookies } from "better-auth/next-js"

import { createAuth, type Auth } from "@/lib/auth/create-auth"
import { db } from "@/lib/data/db"

/**
 * The application's Better Auth instance, bound to the pooled Prisma client
 * and the process environment. Only the route handler (app/api/auth) and
 * the session boundary (lib/auth/session.ts) import it. Created lazily so a
 * missing BETTER_AUTH_SECRET fails the first auth request with a clear
 * message instead of breaking every module that imports this file.
 *
 * `nextCookies` is the documented Next.js integration plugin: it forwards
 * Set-Cookie headers when an auth API call runs inside a Server Action (the
 * development quick sign-in) and skips the session refresh during React
 * Server Component renders, where a cookie cannot be written. It must be the
 * last plugin.
 */
let instance: Auth | undefined

export function getAuth(): Auth {
  instance ??= createAuth({ prisma: db, env: process.env, plugins: [nextCookies()] })
  return instance
}
