import { readDatabaseLabel, resolveRuntimeEnvironment, type DatabaseLabel, type EnvLike, type RuntimeEnvironment } from "@/lib/env/runtime-environment"

/**
 * Which database a deployment is really connected to, judged three ways
 * (docs/security/production-hardening.md, "Database isolation guard"):
 *
 * 1. Endpoint allowlist: MATCHBASE_DATABASE_ENDPOINT names the Neon endpoint
 *    this environment must use; both connection strings must point at it,
 *    DATABASE_URL through that endpoint's pooler, DATABASE_URL_UNPOOLED
 *    directly.
 * 2. Production denylist: the Production endpoints, written here, are refused
 *    for every environment except Production, whatever the label and the
 *    allowlist variable say. A Preview whose variables were all copied from
 *    Production is still stopped.
 * 3. Database identity marker: `COMMENT ON DATABASE … IS 'matchbase:<label>'`,
 *    compared with the label by the operator's `production:check --db` only.
 *    It is not checked at server startup.
 *
 * Pure and synchronous. Like the rest of the readiness report, results
 * name variables only: never a connection string, credential, hostname or
 * endpoint id, neither the one found nor the one expected.
 */

export const DATABASE_ENDPOINT_VARIABLE = "MATCHBASE_DATABASE_ENDPOINT"

/**
 * Neon endpoints that hold Production data, confirmed against the Neon API on 2026-11-10
 * (project red-boat-95339248, read-only `list_branch_computes`):
 *
 * - `ep-crimson-mouse-b3yykfxq`: branch `production` (br-lively-mud-b33xf2xq);
 * - `ep-super-poetry-b37z6bie`: branch `pre-phase11-migration-20261109` (br-orange-resonance-b3s4ujd4), a
 *   recovery copy of Production data.
 *
 * Endpoint ids are not secrets. Add any new Production endpoint here; removing one weakens the guard.
 */
export const PRODUCTION_DATABASE_ENDPOINTS: readonly string[] = ["ep-crimson-mouse-b3yykfxq", "ep-super-poetry-b37z6bie"]

/** A Neon endpoint id: `ep-` and hyphen-separated lowercase words, never a `-pooler` host label. */
const ENDPOINT_ID = /^ep-[a-z0-9]+(?:-[a-z0-9]+){2,}$/

export type EndpointReference = {
  /** The first label of the host the driver connects to, lower-cased (an endpoint id, possibly with `-pooler` or a compute suffix). */
  hostLabel: string
  /** The rest of that host (region and proxy domain), lower-cased. */
  domain: string
  /** An endpoint named in the `options` parameter (`endpoint=<id>`), which Neon also routes on. */
  optionsEndpoint: string | null
  /** A `host` or `hostaddr` query parameter is present: it replaces the URL's hostname in node-postgres. */
  hostOverride: boolean
}

/** Decodes every well-formed %XX sequence; never throws on a malformed one (unlike decodeURIComponent). */
function decodePercent(value: string): string {
  return value.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

/**
 * The endpoint identity of a connection string, as the driver will resolve it, or null when it does not
 * parse. node-postgres (pg-connection-string) takes the host from a `host` query parameter when there is
 * one (the last one wins) and otherwise percent-decodes the URL hostname; both are mirrored here so the
 * guard judges the host that is really connected to. Never includes credentials.
 */
export function endpointReference(value: string | undefined): EndpointReference | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!/^postgres(ql)?:$/.test(url.protocol) || !url.hostname) return null
    const overrides = [...url.searchParams.getAll("host"), ...url.searchParams.getAll("hostaddr")]
    const host = (url.searchParams.getAll("host").at(-1) ?? decodePercent(url.hostname)).trim().toLowerCase()
    const dot = host.indexOf(".")
    // searchParams values are already decoded once, as the driver sees them.
    const options = url.searchParams.getAll("options").join(" ")
    const optionsEndpoint = /endpoint=([a-z0-9-]+)/i.exec(options)?.[1]?.toLowerCase() ?? null
    return { hostLabel: dot < 0 ? host : host.slice(0, dot), domain: dot < 0 ? "" : host.slice(dot + 1), optionsEndpoint, hostOverride: overrides.length > 0 }
  } catch {
    return null
  }
}

/**
 * True when a connection string mentions a Production endpoint anywhere: host, any query parameter,
 * user name, even inside a percent-encoded or doubly encoded form. Deliberately broader than how a driver
 * reads the string, so no parsing difference between this guard and a driver can let one through. The
 * ids are long and distinctive; a false match is not a realistic concern.
 */
export function mentionsProductionEndpoint(value: string | undefined): boolean {
  if (!value) return false
  const lower = value.toLowerCase()
  const forms = [lower, decodePercent(lower), decodePercent(decodePercent(lower))]
  return PRODUCTION_DATABASE_ENDPOINTS.some((endpoint) => forms.some((form) => form.includes(endpoint)))
}

/**
 * True when a host label or an options value belongs to `endpoint`: the endpoint itself, its pooler
 * (`<id>-pooler`) or one of its compute-specific hosts (`<id>-<binding>`, `<id>-<binding>-pooler`).
 */
export function belongsToEndpoint(name: string, endpoint: string): boolean {
  return name === endpoint || name.startsWith(`${endpoint}-`)
}

function productionEndpointOf(reference: EndpointReference): string | null {
  for (const endpoint of PRODUCTION_DATABASE_ENDPOINTS) {
    if (belongsToEndpoint(reference.hostLabel, endpoint)) return endpoint
    if (reference.optionsEndpoint && belongsToEndpoint(reference.optionsEndpoint, endpoint)) return endpoint
  }
  return null
}

export type IdentityCheck = { id: "database-endpoint" | "database-endpoint-denylist"; status: "pass" | "warn" | "fail" | "info"; detail: string; previewCritical?: boolean }

const URLS = [
  { variable: "DATABASE_URL", pooled: true },
  { variable: "DATABASE_URL_UNPOOLED", pooled: false },
] as const

/** The endpoint allowlist and the Production denylist, as readiness checks for this environment. */
export function evaluateDatabaseEndpoints(env: EnvLike): IdentityCheck[] {
  const environment = resolveRuntimeEnvironment(env)
  const checks: IdentityCheck[] = []
  const present = URLS.filter(({ variable }) => env[variable]?.trim())
  const references = present.map(({ variable, pooled }) => ({ variable, pooled, reference: endpointReference(env[variable]) }))

  // 2. Denylist: independent of the allowlist variable. It steps aside only where the environment intent AND the
  // database label are both production; a Production intent with another label is a label failure anyway.
  if (!(environment === "production" && readDatabaseLabel(env) === "production")) {
    const hits: string[] = present.flatMap(({ variable }) => {
      const reference = endpointReference(env[variable])
      return mentionsProductionEndpoint(env[variable]) || (reference && productionEndpointOf(reference)) ? [variable] : []
    })
    const expected = env[DATABASE_ENDPOINT_VARIABLE]?.trim().toLowerCase()
    if (expected && PRODUCTION_DATABASE_ENDPOINTS.some((endpoint) => belongsToEndpoint(expected, endpoint))) hits.push(DATABASE_ENDPOINT_VARIABLE)
    if (hits.length > 0) {
      checks.push({ id: "database-endpoint-denylist", status: "fail", previewCritical: true, detail: `A ${environment} environment points at a Production database endpoint (${hits.join(", ")}). Only Production may use it; replace these values with this environment's own database.` })
    } else {
      checks.push({ id: "database-endpoint-denylist", status: "pass", detail: `No connection string points at a Production database endpoint (${PRODUCTION_DATABASE_ENDPOINTS.length} known).` })
    }
  }

  // 1. Allowlist.
  const mismatch: Pick<IdentityCheck, "status" | "previewCritical"> = environment === "production" ? { status: "fail" } : environment === "preview" ? { status: "fail", previewCritical: true } : { status: "warn" }
  const raw = env[DATABASE_ENDPOINT_VARIABLE]?.trim()
  if (!raw) {
    if (environment === "preview") checks.push({ id: "database-endpoint", status: "fail", previewCritical: true, detail: `${DATABASE_ENDPOINT_VARIABLE} is not set; a Preview must name the Neon endpoint of its own database (the ep-… id of the Preview branch).` })
    // Production does not refuse to start until the operator has set the variable (an outage otherwise).
    else if (environment === "production") checks.push({ id: "database-endpoint", status: "warn", detail: `${DATABASE_ENDPOINT_VARIABLE} is not set, so the connection strings are not checked against the expected endpoint. Set it to the Production endpoint id.` })
    else checks.push({ id: "database-endpoint", status: "info", detail: `${DATABASE_ENDPOINT_VARIABLE} is not set (optional in development).` })
    return checks
  }
  const expected = raw.toLowerCase()
  if (!ENDPOINT_ID.test(expected) || expected.endsWith("-pooler")) {
    checks.push({ id: "database-endpoint", ...mismatch, detail: `${DATABASE_ENDPOINT_VARIABLE} must be a Neon endpoint id such as ep-word-word-abc12345 (not a hostname, not a -pooler label).` })
    return checks
  }
  if (references.length === 0) {
    checks.push({ id: "database-endpoint", ...mismatch, detail: "No database connection string is set to check against the expected endpoint." })
    return checks
  }

  const problems: string[] = []
  for (const { variable, pooled, reference } of references) {
    if (!reference) {
      problems.push(`${variable} does not parse as a PostgreSQL connection string with a hostname`)
      continue
    }
    const want = pooled ? `${expected}-pooler` : expected
    if (reference.hostOverride) problems.push(`${variable} carries a host or hostaddr parameter, which would replace its hostname`)
    if (!/(^|\.)neon\.tech$/.test(reference.domain)) problems.push(`${variable} is not a Neon host (*.neon.tech)`)
    if (reference.hostLabel !== want) problems.push(`${variable} is not on ${pooled ? "the endpoint's pooler host (<endpoint>-pooler)" : "the endpoint's direct host (<endpoint>, no -pooler)"}`)
    if (reference.optionsEndpoint && reference.optionsEndpoint !== expected) problems.push(`${variable} names another endpoint in its options parameter`)
  }
  const domains = new Set(references.flatMap(({ reference }) => (reference ? [reference.domain] : [])))
  if (domains.size > 1) problems.push("DATABASE_URL and DATABASE_URL_UNPOOLED are in different Neon regions or domains")

  if (problems.length > 0) checks.push({ id: "database-endpoint", ...mismatch, detail: `The connection strings do not belong to the endpoint in ${DATABASE_ENDPOINT_VARIABLE}: ${problems.join("; ")}.` })
  else checks.push({ id: "database-endpoint", status: "pass", detail: `${references.map(({ variable }) => variable).join(" and ")} use the endpoint in ${DATABASE_ENDPOINT_VARIABLE}${references.length === 1 ? " (DATABASE_URL_UNPOOLED is not set)" : ", pooled and direct"}.` })
  return checks
}

// ---------------------------------------------------------------------------
// Database identity marker (operator check only)
// ---------------------------------------------------------------------------

export const DATABASE_MARKER_PREFIX = "matchbase:"

/** The marker a database with this label must carry. */
export function expectedDatabaseMarker(label: DatabaseLabel): string {
  return `${DATABASE_MARKER_PREFIX}${label}`
}

/** Read-only, runnable by any role: the comment on the current database (pg_shdescription is world-readable). */
export const READ_DATABASE_MARKER_SQL = "SELECT shobj_description(d.oid, 'pg_database') AS marker FROM pg_database d WHERE d.datname = current_database()"

/** The owner-only statement an operator runs once per database. The name is quoted; the marker is a fixed literal. */
export function setDatabaseMarkerSql(database: string, label: DatabaseLabel): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error("The database name must be a plain lower-case identifier.")
  return `COMMENT ON DATABASE "${database}" IS '${expectedDatabaseMarker(label)}'`
}

export type MarkerResult = { status: "pass" | "warn" | "fail"; detail: string }

/**
 * Compares the marker read from the database with the environment's label.
 * Absent or wrong is a failure on Production and Preview. A read that failed
 * (permissions, query error) is a failure everywhere: never skipped silently.
 */
export function evaluateDatabaseMarker(input: { env: EnvLike; marker: string | null | undefined; readFailed?: boolean }): MarkerResult {
  const environment: RuntimeEnvironment = resolveRuntimeEnvironment(input.env)
  const label = readDatabaseLabel(input.env)
  if (input.readFailed) return { status: "fail", detail: "The database identity marker could not be read (the query failed or was not permitted); the database identity is unverified." }
  if (!label) return { status: environment === "development" ? "warn" : "fail", detail: "MATCHBASE_DATABASE_LABEL is not set, so the database identity marker cannot be compared." }
  const expected = expectedDatabaseMarker(label)
  const marker = input.marker?.trim() ?? ""
  const strict = environment === "development" ? "warn" : "fail"
  if (!marker) return { status: strict, detail: `The database carries no identity marker; expected '${expected}' (COMMENT ON DATABASE, set once by the owner).` }
  if (!/^matchbase:(development|preview|production)$/.test(marker)) return { status: "fail", detail: `The database comment is not a MatchBase identity marker; expected '${expected}'.` }
  if (marker !== expected) return { status: "fail", detail: `The database identifies itself as '${marker}', but this shell is labelled ${label}; expected '${expected}'. Wrong database.` }
  return { status: "pass", detail: `The database identifies itself as '${marker}', matching the label.` }
}
