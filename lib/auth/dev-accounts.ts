import type { DevAccount } from "@/lib/auth/dev-login"
import type { Prisma } from "@/lib/generated/prisma/client"

/**
 * Creates or repairs the two development accounts through Better Auth's own
 * sign-up API, so they carry a real credential row with a scrypt hash and
 * sign in through the normal path. The role is then set directly, which is
 * what the operator CLI does for real accounts. Idempotent: an existing
 * account is left alone apart from its role. Written against injected
 * dependencies so the database tests can run it with their own instance.
 *
 * Callers must have checked `resolveDevLogin` first: this function does not
 * know which environment it runs in.
 */

export type DevAccountsAuth = {
  api: { signUpEmail: (input: { body: { name: string; email: string; password: string } }) => Promise<unknown> }
}

export type DevAccountsClient = Pick<Prisma.TransactionClient, "user">

export type ProvisionedDevAccount = { role: DevAccount["role"]; email: string; created: boolean; roleChanged: boolean }

export async function provisionDevAccounts(deps: { auth: DevAccountsAuth; prisma: DevAccountsClient }, accounts: readonly DevAccount[]): Promise<ProvisionedDevAccount[]> {
  const results: ProvisionedDevAccount[] = []
  for (const account of accounts) {
    let created = false
    let existing = await deps.prisma.user.findUnique({ where: { email: account.email }, select: { id: true, role: true, accounts: { select: { id: true }, take: 1 } } })
    if (!existing) {
      await deps.auth.api.signUpEmail({ body: { name: account.name, email: account.email, password: account.password } })
      created = true
      existing = await deps.prisma.user.findUnique({ where: { email: account.email }, select: { id: true, role: true, accounts: { select: { id: true }, take: 1 } } })
      if (!existing) throw new Error(`Development account ${account.email} was not created.`)
    } else if (existing.accounts.length === 0) {
      throw new Error(`${account.email} exists without a sign-in credential; choose a different development email.`)
    }
    const roleChanged = existing.role !== account.role
    // Development fixtures only (the caller checked resolveDevLogin): the accounts are confirmed so the quick
    // sign-in keeps working when a local mail transport turns on required verification.
    await deps.prisma.user.update({ where: { id: existing.id }, data: { role: account.role, emailVerified: true } })
    results.push({ role: account.role, email: account.email, created, roleChanged })
  }
  return results
}
