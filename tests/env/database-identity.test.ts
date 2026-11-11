import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  belongsToEndpoint,
  evaluateDatabaseEndpoints,
  evaluateDatabaseMarker,
  expectedDatabaseMarker,
  PRODUCTION_DATABASE_ENDPOINTS,
  READ_DATABASE_MARKER_SQL,
  setDatabaseMarkerSql,
} from "../../lib/env/database-identity"
import { blockingChecks, evaluateProductionReadiness } from "../../lib/env/production-config"

/** Synthetic, nonfunctional values: a Preview endpoint id and credentials that must never be echoed. */
const PREVIEW_EP = "ep-quiet-pond-p1r2v3w4"
const OTHER_EP = "ep-loud-river-z9y8x7w6"
const DOMAIN = "c-4.ap-southeast-1.aws.neon.tech"
const PASS_RUNTIME = "runtime-secret-pass"
const PASS_OWNER = "owner-secret-pass"
const pooled = (ep: string, extra = "") => `postgresql://matchbase_app:${PASS_RUNTIME}@${ep}-pooler.${DOMAIN}/matchbase_preview?sslmode=verify-full${extra}`
const direct = (ep: string, extra = "") => `postgresql://neondb_owner:${PASS_OWNER}@${ep}.${DOMAIN}/matchbase_preview?sslmode=require&sslaccept=strict&channel_binding=require${extra}`
const PROD_EP = PRODUCTION_DATABASE_ENDPOINTS[0]

const preview = (over: Record<string, string | undefined> = {}) => ({
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_URL: "matchbase-git-x.vercel.app",
  MATCHBASE_DATABASE_LABEL: "preview",
  MATCHBASE_DATABASE_ENDPOINT: PREVIEW_EP,
  DATABASE_URL: pooled(PREVIEW_EP),
  DATABASE_URL_UNPOOLED: direct(PREVIEW_EP),
  BETTER_AUTH_SECRET: "Qm9a7x3fKp2LwZ8vN4cR1tY6uH0sJ5eD9gB3nM7kV1a=",
  ...over,
})

const check = (env: Record<string, string | undefined>, id: string) => evaluateDatabaseEndpoints(env).find((c) => c.id === id)
const blocksPreview = (env: Record<string, string | undefined>, id: string) => blockingChecks(evaluateProductionReadiness(env)).some((c) => c.id === id)

describe("endpoint allowlist (MATCHBASE_DATABASE_ENDPOINT)", () => {
  it("the correct Preview endpoint passes: pooled DATABASE_URL and direct DATABASE_URL_UNPOOLED", () => {
    assert.equal(check(preview(), "database-endpoint")?.status, "pass")
    assert.equal(check(preview(), "database-endpoint-denylist")?.status, "pass")
    assert.equal(blocksPreview(preview(), "database-endpoint"), false)
  })

  it("a wrong endpoint fails and blocks a Preview, for either URL", () => {
    for (const over of [{ DATABASE_URL: pooled(OTHER_EP) }, { DATABASE_URL_UNPOOLED: direct(OTHER_EP) }, { MATCHBASE_DATABASE_ENDPOINT: OTHER_EP }]) {
      assert.equal(check(preview(over), "database-endpoint")?.status, "fail", JSON.stringify(Object.keys(over)))
      assert.equal(blocksPreview(preview(over), "database-endpoint"), true)
    }
  })

  it("pooled and unpooled must be the same endpoint in the right roles", () => {
    const mixed = preview({ DATABASE_URL_UNPOOLED: direct(OTHER_EP) })
    assert.match(check(mixed, "database-endpoint")?.detail ?? "", /DATABASE_URL_UNPOOLED is not on the endpoint's direct host/)
    const swapped = preview({ DATABASE_URL: direct(PREVIEW_EP).replace("neondb_owner", "matchbase_app"), DATABASE_URL_UNPOOLED: pooled(PREVIEW_EP) })
    const detail = check(swapped, "database-endpoint")?.detail ?? ""
    assert.match(detail, /DATABASE_URL is not on the endpoint's pooler host/)
    assert.match(detail, /DATABASE_URL_UNPOOLED is not on the endpoint's direct host/)
    const otherRegion = preview({ DATABASE_URL_UNPOOLED: direct(PREVIEW_EP).replace(DOMAIN, "c-2.us-east-2.aws.neon.tech") })
    assert.match(check(otherRegion, "database-endpoint")?.detail ?? "", /different Neon regions or domains/)
  })

  it("a host that is not on neon.tech is refused even with the right endpoint label", () => {
    assert.match(check(preview({ DATABASE_URL: pooled(PREVIEW_EP).replace(DOMAIN, "neon.tech.example.com") , DATABASE_URL_UNPOOLED: direct(PREVIEW_EP).replace(DOMAIN, "neon.tech.example.com") }), "database-endpoint")?.detail ?? "", /not a Neon host/)
  })

  it("compute-specific hosts and an options endpoint are not the expected form", () => {
    assert.equal(check(preview({ DATABASE_URL: pooled(PREVIEW_EP).replace(`${PREVIEW_EP}-pooler`, `${PREVIEW_EP}-hcw-pooler`) }), "database-endpoint")?.status, "fail")
    assert.match(check(preview({ DATABASE_URL: pooled(PREVIEW_EP, `&options=endpoint%3D${OTHER_EP}`) }), "database-endpoint")?.detail ?? "", /options parameter/)
  })

  it("missing: blocks a Preview, only warns in Production (no outage before the operator sets it), informs in development", () => {
    assert.equal(check(preview({ MATCHBASE_DATABASE_ENDPOINT: undefined }), "database-endpoint")?.status, "fail")
    assert.equal(blocksPreview(preview({ MATCHBASE_DATABASE_ENDPOINT: undefined }), "database-endpoint"), true)
    assert.equal(check({ VERCEL_ENV: "production", DATABASE_URL: pooled(PROD_EP) }, "database-endpoint")?.status, "warn")
    assert.equal(check({ DATABASE_URL: pooled(OTHER_EP) }, "database-endpoint")?.status, "info")
  })

  it("rejects a value that is not an endpoint id", () => {
    for (const value of ["ep-quiet-pond-p1r2v3w4-pooler", `${PREVIEW_EP}.${DOMAIN}`, "quiet-pond", "ep-x"]) {
      assert.match(check(preview({ MATCHBASE_DATABASE_ENDPOINT: value }), "database-endpoint")?.detail ?? "", /must be a Neon endpoint id/, value)
    }
  })

  it("Production with its own endpoint passes; with a Preview endpoint it fails", () => {
    const prod = { VERCEL_ENV: "production", MATCHBASE_DATABASE_LABEL: "production", MATCHBASE_DATABASE_ENDPOINT: PROD_EP, DATABASE_URL: pooled(PROD_EP), DATABASE_URL_UNPOOLED: direct(PROD_EP) }
    assert.equal(check(prod, "database-endpoint")?.status, "pass")
    assert.equal(check(prod, "database-endpoint-denylist"), undefined, "the denylist does not apply to Production")
    assert.equal(check({ ...prod, DATABASE_URL: pooled(PREVIEW_EP) }, "database-endpoint")?.status, "fail")
  })
})

describe("Production endpoint denylist", () => {
  it("lists the endpoints confirmed against the Neon API, as plain endpoint ids", () => {
    assert.deepEqual([...PRODUCTION_DATABASE_ENDPOINTS], ["ep-crimson-mouse-b3yykfxq", "ep-super-poetry-b37z6bie"])
  })

  it("a Preview using a Production endpoint fails and is blocked, even when every other value agrees with it", () => {
    for (const endpoint of PRODUCTION_DATABASE_ENDPOINTS) {
      // The whole Production set copied into Preview, allowlist variable included: the allowlist alone would pass.
      const copied = preview({ MATCHBASE_DATABASE_ENDPOINT: endpoint, DATABASE_URL: pooled(endpoint), DATABASE_URL_UNPOOLED: direct(endpoint) })
      assert.equal(check(copied, "database-endpoint")?.status, "pass", "the allowlist is consistent with itself")
      const deny = check(copied, "database-endpoint-denylist")
      assert.equal(deny?.status, "fail")
      assert.equal(deny?.previewCritical, true)
      assert.match(deny?.detail ?? "", /DATABASE_URL, DATABASE_URL_UNPOOLED, MATCHBASE_DATABASE_ENDPOINT/)
      assert.equal(blocksPreview(copied, "database-endpoint-denylist"), true)
    }
  })

  it("catches a single URL, the pooler, compute-specific hosts and an options endpoint", () => {
    const variants = [
      { DATABASE_URL: pooled(PROD_EP) },
      { DATABASE_URL_UNPOOLED: direct(PROD_EP) },
      { DATABASE_URL: pooled(PREVIEW_EP).replace(`${PREVIEW_EP}-pooler`, `${PROD_EP}-ggl-pooler`) },
      { DATABASE_URL_UNPOOLED: direct(PREVIEW_EP).replace(PREVIEW_EP, `${PROD_EP}-ggl`) },
      { DATABASE_URL: `postgresql://u:p@${DOMAIN}/neondb?sslmode=verify-full&options=endpoint%3D${PROD_EP}` },
      { DATABASE_URL: pooled(PREVIEW_EP).replace(PREVIEW_EP, PROD_EP.toUpperCase()) },
    ]
    for (const over of variants) assert.equal(check(preview(over), "database-endpoint-denylist")?.status, "fail", JSON.stringify(over))
  })

  it("applies to development and operator shells too; steps aside only when intent AND label are production", () => {
    assert.equal(check({ DATABASE_URL: pooled(PROD_EP) }, "database-endpoint-denylist")?.status, "fail")
    assert.equal(check({ VERCEL_ENV: "production", MATCHBASE_DATABASE_LABEL: "production", DATABASE_URL: pooled(PROD_EP) }, "database-endpoint-denylist"), undefined)
    assert.equal(check({ VERCEL_ENV: "production", DATABASE_URL: pooled(PROD_EP) }, "database-endpoint-denylist")?.status, "fail", "no label")
    assert.equal(check({ VERCEL_ENV: "production", MATCHBASE_DATABASE_LABEL: "preview", DATABASE_URL: pooled(PROD_EP) }, "database-endpoint-denylist")?.status, "fail", "production intent, preview label")
  })

  it("sees the host the driver connects to: a host query parameter and a percent-encoded hostname", () => {
    // node-postgres replaces the hostname with a `host` parameter and percent-decodes the hostname.
    const viaHostParam = pooled(PREVIEW_EP, `&host=${PROD_EP}-pooler.${DOMAIN}`)
    assert.equal(check(preview({ DATABASE_URL: viaHostParam }), "database-endpoint-denylist")?.status, "fail")
    assert.match(check(preview({ DATABASE_URL: viaHostParam }), "database-endpoint")?.detail ?? "", /host or hostaddr parameter/)
    const encoded = pooled(PREVIEW_EP).replace(`${PREVIEW_EP}-pooler`, `%65p${PROD_EP.slice(2)}-pooler`)
    assert.equal(check(preview({ DATABASE_URL: encoded }), "database-endpoint-denylist")?.status, "fail")
    const encodedDash = pooled(PREVIEW_EP).replace(`${PREVIEW_EP}-pooler`, `${PROD_EP.replace(/-/g, "%2D")}-pooler`)
    assert.equal(check(preview({ DATABASE_URL: encodedDash }), "database-endpoint-denylist")?.status, "fail")
  })

  it("an options value the strict decoder would reject is still scanned", () => {
    const malformed = pooled(PREVIEW_EP, `&options=endpoint%3D${PROD_EP}%20x%25`)
    assert.equal(check(preview({ DATABASE_URL: malformed }), "database-endpoint-denylist")?.status, "fail")
  })

  it("matches by endpoint prefix, not by substring", () => {
    assert.equal(belongsToEndpoint(`${PROD_EP}-pooler`, PROD_EP), true)
    assert.equal(belongsToEndpoint(`${PROD_EP}x`, PROD_EP), false)
    assert.equal(belongsToEndpoint(`x${PROD_EP}`, PROD_EP), false)
  })
})

describe("database identity marker (operator check)", () => {
  const env = (label: string, VERCEL_ENV = label) => ({ VERCEL_ENV, MATCHBASE_DATABASE_LABEL: label })

  it("matches the label: matchbase:preview and matchbase:production", () => {
    assert.equal(expectedDatabaseMarker("preview"), "matchbase:preview")
    assert.equal(evaluateDatabaseMarker({ env: env("preview"), marker: "matchbase:preview" }).status, "pass")
    assert.equal(evaluateDatabaseMarker({ env: env("production"), marker: "matchbase:production" }).status, "pass")
  })

  it("a marker that disagrees with the label fails, in both directions", () => {
    const wrong = evaluateDatabaseMarker({ env: env("preview"), marker: "matchbase:production" })
    assert.equal(wrong.status, "fail")
    assert.match(wrong.detail, /Wrong database/)
    assert.equal(evaluateDatabaseMarker({ env: env("production"), marker: "matchbase:preview" }).status, "fail")
    assert.equal(evaluateDatabaseMarker({ env: env("preview"), marker: "some other comment" }).status, "fail")
  })

  it("a missing marker fails on Production and Preview, warns in development", () => {
    for (const marker of [null, undefined, "", "  "]) {
      assert.equal(evaluateDatabaseMarker({ env: env("preview"), marker }).status, "fail")
      assert.equal(evaluateDatabaseMarker({ env: env("production"), marker }).status, "fail")
    }
    assert.equal(evaluateDatabaseMarker({ env: env("development"), marker: null }).status, "warn")
  })

  it("a failed or forbidden read is a failure, never skipped; a missing label cannot be compared", () => {
    for (const label of ["development", "preview", "production"]) assert.equal(evaluateDatabaseMarker({ env: env(label), marker: null, readFailed: true }).status, "fail")
    assert.equal(evaluateDatabaseMarker({ env: { VERCEL_ENV: "preview" }, marker: "matchbase:preview" }).status, "fail")
  })

  it("the read is read-only and the set statement is fixed and quoted", () => {
    assert.match(READ_DATABASE_MARKER_SQL, /^SELECT shobj_description/)
    assert.doesNotMatch(READ_DATABASE_MARKER_SQL, /COMMENT|UPDATE|INSERT|DELETE/i)
    assert.equal(setDatabaseMarkerSql("matchbase_preview", "preview"), `COMMENT ON DATABASE "matchbase_preview" IS 'matchbase:preview'`)
    assert.throws(() => setDatabaseMarkerSql(`x"; DROP DATABASE neondb; --`, "preview"))
  })
})

describe("nothing secret or identifying is printed", () => {
  it("no connection string, credential, host or endpoint id appears in any result", () => {
    const envs = [
      preview(),
      preview({ DATABASE_URL: pooled(OTHER_EP) }),
      preview({ MATCHBASE_DATABASE_ENDPOINT: PROD_EP, DATABASE_URL: pooled(PROD_EP), DATABASE_URL_UNPOOLED: direct(PROD_EP) }),
      preview({ DATABASE_URL: pooled(PREVIEW_EP, `&options=endpoint%3D${PROD_EP}`) }),
    ]
    for (const env of envs) {
      const text = JSON.stringify([evaluateDatabaseEndpoints(env), evaluateProductionReadiness(env).checks])
      for (const leak of [PASS_RUNTIME, PASS_OWNER, "postgresql://", "neon.tech", PREVIEW_EP, OTHER_EP, ...PRODUCTION_DATABASE_ENDPOINTS]) assert.equal(text.includes(leak), false, leak)
    }
    const marker = JSON.stringify(evaluateDatabaseMarker({ env: { VERCEL_ENV: "preview", MATCHBASE_DATABASE_LABEL: "preview" }, marker: "matchbase:production" }))
    assert.doesNotMatch(marker, /postgres|neon\.tech|ep-/)
  })
})
