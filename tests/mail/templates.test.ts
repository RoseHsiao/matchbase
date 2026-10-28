import assert from "node:assert/strict"
import { after, describe, it } from "node:test"

import { PASSWORD_RESET_TOKEN_TTL_SECONDS } from "../../lib/auth/password-policy"
import { buildPasswordResetUrl, normalizePasswordResetUrl } from "../../lib/auth/reset-link"
import { invalidMessageReason, type MailMessage } from "../../lib/mail/mailer"
import { createCaptureMailer } from "../../lib/mail/transports/capture"
import { greetingName, MAX_GREETING_NAME_LENGTH } from "../../lib/mail/templates/display-name"
import { PASSWORD_CHANGED_KIND, PASSWORD_CHANGED_SUBJECT, passwordChangedEmail } from "../../lib/mail/templates/password-changed"
import { PASSWORD_RESET_KIND, PASSWORD_RESET_SUBJECT, passwordResetEmail } from "../../lib/mail/templates/password-reset"
import { escapeHtml } from "../../lib/mail/templates/render"

const TOKEN = "q8Zr2Kd9LmN4pX7wT1vB3cYh"
const BASE = "https://matchbase-demo.vercel.app"
const RESET_URL = `${BASE}/reset-password#token=${TOKEN}`
const TO = "person@example.com"

const realFetch = globalThis.fetch
globalThis.fetch = (() => {
  throw new Error("A template test tried to reach the network.")
}) as typeof fetch
after(() => {
  globalThis.fetch = realFetch
})

function reset(input: { resetUrl?: string; name?: string | null } = {}): MailMessage {
  const result = passwordResetEmail({ to: TO, resetUrl: input.resetUrl ?? RESET_URL, name: input.name })
  assert.ok(result.ok, "expected a message")
  return result.message
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/** Markup that would load something, run something, or hide something. */
function assertInertHtml(html: string): void {
  assert.doesNotMatch(html, /<(img|script|link|iframe|object|embed|style|form|input|video|audio|svg|base|meta http-equiv)\b/i)
  // Attributes are checked inside tags only: escaped user text may legitimately contain words like "onclick=".
  const tags = html.match(/<[^>]+>/g) ?? []
  for (const tag of tags) {
    assert.doesNotMatch(tag, /\ssrc\s*=|\son[a-z]+\s*=|url\(|@import|javascript:|expression\(/i, tag)
    assert.doesNotMatch(tag, /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|max-height\s*:\s*0|font-size\s*:\s*0\b/i, `no hidden preheader or metadata: ${tag}`)
  }
  assert.doesNotMatch(html, /<!--/, "no comments")
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
  for (const href of hrefs) assert.match(href, /^https?:\/\//, "every link is an http(s) URL")
}

describe("reset link construction", () => {
  it("puts the token in the fragment of the base URL's reset path", () => {
    assert.equal(buildPasswordResetUrl(BASE, TOKEN), RESET_URL)
    assert.equal(buildPasswordResetUrl(`${BASE}/`, TOKEN), RESET_URL)
    assert.equal(buildPasswordResetUrl("http://localhost:3000", TOKEN), `http://localhost:3000/reset-password#token=${TOKEN}`)
    assert.equal(normalizePasswordResetUrl(buildPasswordResetUrl(BASE, TOKEN)!), RESET_URL)
  })

  it("refuses unsafe bases and malformed tokens", () => {
    for (const base of ["http://matchbase.example", "ftp://matchbase.example", "javascript:alert(1)", "https://user:pw@matchbase.example", "https://matchbase.example/?x=1", "not a url", ""]) {
      assert.equal(buildPasswordResetUrl(base, TOKEN), null, base)
    }
    for (const token of ["", "short", "has space in the token value", "a".repeat(257), "tok<en>0123456789abc", "tok&en=0123456789abc"]) {
      assert.equal(buildPasswordResetUrl(BASE, token), null, token)
    }
  })
})

describe("password-reset email", () => {
  it("is a valid MailMessage the mailer accepts", async () => {
    const message = reset()
    assert.equal(message.kind, PASSWORD_RESET_KIND)
    assert.equal(message.to, TO)
    assert.equal(invalidMessageReason(message), null)
    const capture = createCaptureMailer({})
    assert.equal((await capture.send(message)).status, "sent")
    assert.equal(capture.messages[0].text, message.text)
  })

  it("has the exact plain-text content, with the full URL on its own line", () => {
    assert.equal(
      reset({ name: "Rose" }).text,
      [
        "Hi Rose,",
        "",
        "We received a request to reset the password for your MatchBase account. To choose a new password, use the link below.",
        "",
        RESET_URL,
        "",
        "This link expires in 30 minutes and can be used once.",
        "",
        "If you didn't request this, you can ignore this email. Your password stays the same unless you choose a new one with this link.",
        "",
        "— MatchBase",
        "",
        "You're receiving this because a password reset was requested for your MatchBase account.",
        "",
      ].join("\n")
    )
  })

  it("has one Reset password action in HTML pointing at the link", () => {
    const { html = "" } = reset()
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)]
    assert.equal(anchors.length, 1)
    assert.equal(anchors[0][1], RESET_URL)
    assert.equal(anchors[0][2], "Reset password")
    assert.match(html, /<title>Reset your MatchBase password<\/title>/)
    assert.match(html, />MatchBase<\/p>/)
    assert.match(html, /This link expires in 30 minutes and can be used once\./)
    assert.match(html, /If you didn&#39;t request this, you can ignore this email\./)
    assertInertHtml(html)
  })

  it("the reset URL appears only in the HTML href and the text body, never the subject", () => {
    const message = reset()
    assert.equal(occurrences(message.text, RESET_URL), 1)
    assert.equal(occurrences(message.html ?? "", RESET_URL), 1)
    assert.equal(occurrences(message.text + (message.html ?? ""), TOKEN), 2)
    assert.equal(message.subject, PASSWORD_RESET_SUBJECT)
    assert.ok(!message.subject.includes(TOKEN) && !message.subject.includes(TO))
    assert.equal(message.idempotencyKey, undefined)
  })

  it("never puts the recipient address in the content", () => {
    const message = reset({ name: TO })
    for (const part of [message.subject, message.text, message.html ?? ""]) assert.ok(!part.includes(TO))
    assert.match(message.text, /^Hi,\n/)
  })

  it("states the lifetime from the shared constant: 30 minutes", () => {
    assert.equal(PASSWORD_RESET_TOKEN_TTL_SECONDS, 1800)
    assert.match(reset().text, /expires in 30 minutes/)
    assert.doesNotMatch(reset().text, /\b(1 hour|60 minutes|24 hours)\b/)
  })

  it("does not suggest the password already changed, nor name internals", () => {
    const text = reset().text.replace(RESET_URL, "").toLowerCase()
    assert.doesNotMatch(text, /password (has been|was) (changed|reset)|new password is/)
    assert.doesNotMatch(text, /better auth|token|verification|resend|database|api\//)
  })

  it("refuses malformed or unsafe reset URLs instead of mailing them", () => {
    for (const resetUrl of [
      "",
      "not a url",
      "javascript:alert(1)//reset-password#token=q8Zr2Kd9LmN4pX7wT1vB3cYh",
      "data:text/html,<script>alert(1)</script>",
      `http://matchbase.example/reset-password#token=${TOKEN}`,
      `https://user:pw@matchbase.example/reset-password#token=${TOKEN}`,
      `${BASE}/reset-password?token=${TOKEN}`,
      `${BASE}/api/auth/reset-password/${TOKEN}?callbackURL=%2F`,
      `${BASE}/reset-password`,
      `${BASE}/reset-password#token=`,
      `${BASE}/reset-password#token=short`,
      `${BASE}/reset-password#token=${TOKEN}&next=/evil`,
      `${BASE}/elsewhere#token=${TOKEN}`,
      `${BASE}/reset-password#token=${TOKEN}" onclick="alert(1)`,
      `${BASE}/reset-password#token=${TOKEN}<b>`,
      ` ${RESET_URL}`,
      `${RESET_URL}\n`,
      `${BASE}/reset-password#token=${"a".repeat(2100)}`,
    ]) {
      assert.deepEqual(passwordResetEmail({ to: TO, resetUrl }), { ok: false, reason: "invalid-reset-url" }, resetUrl)
    }
  })

  it("is deterministic", () => {
    assert.deepEqual(reset({ name: "Rose" }), reset({ name: "Rose" }))
  })
})

describe("password-changed email", () => {
  it("is a valid MailMessage with the security notice", () => {
    const message = passwordChangedEmail({ to: TO, name: "Rose" })
    assert.equal(message.kind, PASSWORD_CHANGED_KIND)
    assert.equal(message.subject, PASSWORD_CHANGED_SUBJECT)
    assert.equal(invalidMessageReason(message), null)
    assert.equal(
      message.text,
      [
        "Hi Rose,",
        "",
        "The password for your MatchBase account was just changed. If you made this change, no action is needed.",
        "",
        `If you didn't make this change, someone else may have access to your account. Go to the MatchBase sign-in page, choose "Forgot password?" to set a new password straight away, and check the security of this email account, since reset links are sent here.`,
        "",
        "— MatchBase",
        "",
        "You're receiving this security notice because the password for your MatchBase account was changed.",
        "",
      ].join("\n")
    )
  })

  it("contains no link, token or invented contact at all", () => {
    const message = passwordChangedEmail({ to: TO })
    const everything = `${message.subject}\n${message.text}\n${message.html}`
    assert.doesNotMatch(everything, /https?:\/\/|www\.|<a\b|href=|#token|token=/i)
    assert.ok(!everything.includes(TO), "no recipient address")
    assert.doesNotMatch(everything, /support|contact us|help desk|security team/i)
    assertInertHtml(message.html ?? "")
  })

  it("is deterministic", () => {
    assert.deepEqual(passwordChangedEmail({ to: TO, name: "Rose" }), passwordChangedEmail({ to: TO, name: "Rose" }))
  })
})

describe("escaping and display names", () => {
  it("escapes every HTML-significant character", () => {
    assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;")
  })

  it("renders malicious-looking names as inert text in both templates", () => {
    for (const name of [`<script>alert("x")</script>`, `"><img src=x onerror=alert(1)>`, `Rose' onmouseover='alert(1)`, "</p><h1>Pwned</h1>", "&lt;already&gt; & more"]) {
      const shown = greetingName(name)
      assert.ok(shown, name)
      for (const message of [reset({ name }), passwordChangedEmail({ to: TO, name })]) {
        const html = message.html ?? ""
        assert.ok(html.includes(`Hi ${escapeHtml(shown)},`), name)
        assert.ok(!html.includes(name), `raw name must not appear: ${name}`)
        assertInertHtml(html)
        assert.ok(message.text.startsWith(`Hi ${shown},\n`), "plain text keeps the literal name")
      }
    }
  })

  it("drops names that look like links or addresses, and strips control and bidi characters", () => {
    for (const name of ["Visit https://evil.example now", "www.evil.example", "someone@example.com", "  ", "", null, undefined]) {
      assert.equal(greetingName(name), null, String(name))
    }
    assert.equal(greetingName("Rose\r\nBcc: x"), "Rose Bcc: x")
    assert.equal(greetingName("Ro‮se​"), "Ro se")
    assert.equal(greetingName("  Rose   Hsiao  "), "Rose Hsiao")
    const long = greetingName("x".repeat(200))
    assert.equal(Array.from(long ?? "").length, MAX_GREETING_NAME_LENGTH)
    assert.ok(long?.endsWith("…"))
  })

  it("a name never changes the reset link or the subject", () => {
    const plain = reset()
    const named = reset({ name: `${RESET_URL.replace(TOKEN, "OtherToken000000000000")}` })
    assert.equal(named.subject, plain.subject)
    assert.equal(occurrences(named.text, "OtherToken"), 0, "a link-like name is dropped")
  })
})
