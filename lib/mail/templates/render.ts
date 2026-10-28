/**
 * The one renderer behind every transactional email: a heading, plain-text
 * paragraphs and at most one action, turned into a plain-text body and a
 * minimal HTML body that say the same thing.
 *
 * The renderer accepts plain strings only, never markup, and escapes every
 * one of them on the way into HTML, so no template can interpolate an
 * unescaped value. The HTML has no images, no external stylesheets or fonts,
 * no scripts, no tracking pixels, no hidden preheader and no metadata: only
 * inline styles and the action link. Output is a pure function of the input
 * (no dates, no random ids), which keeps it testable and diff-able.
 */

export const BRAND_NAME = "MatchBase"

export type EmailBlock = { type: "paragraph"; text: string } | { type: "action"; label: string; url: string }

export type EmailContent = {
  /** Also the HTML <title>; one line. */
  subject: string
  heading: string
  /** Already sanitised; see display-name.ts. Null gives a greeting without a name. */
  greetingName: string | null
  blocks: EmailBlock[]
  /** A short line under the content saying why the message was sent. */
  footer: string
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])
}

function greeting(name: string | null): string {
  return name ? `Hi ${name},` : "Hi,"
}

export function renderText(content: EmailContent): string {
  const lines = [greeting(content.greetingName), ""]
  for (const block of content.blocks) {
    // In plain text the action is its full URL on a line of its own, so every mail client shows the whole address.
    lines.push(block.type === "paragraph" ? block.text : block.url, "")
  }
  lines.push(`— ${BRAND_NAME}`, "", content.footer)
  return `${lines.join("\n")}\n`
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const TEXT_COLOR = "#18181b"
const MUTED_COLOR = "#52525b"

function renderBlock(block: EmailBlock): string {
  if (block.type === "paragraph") return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TEXT_COLOR};">${escapeHtml(block.text)}</p>`
  return [
    `<p style="margin:8px 0 24px;">`,
    `<a href="${escapeHtml(block.url)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:${TEXT_COLOR};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${escapeHtml(block.label)}</a>`,
    `</p>`,
  ].join("")
}

export function renderHtml(content: EmailContent): string {
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>`,
    `<body style="margin:0;padding:24px 16px;background:#f4f4f5;font-family:${FONT};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td align="center">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;border-collapse:collapse;background:#ffffff;border-radius:8px;"><tr><td style="padding:32px 28px;">`,
    `<p style="margin:0 0 24px;font-size:16px;font-weight:700;letter-spacing:-0.01em;color:${TEXT_COLOR};">${BRAND_NAME}</p>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${TEXT_COLOR};">${escapeHtml(content.heading)}</h1>`,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${TEXT_COLOR};">${escapeHtml(greeting(content.greetingName))}</p>`,
    ...content.blocks.map(renderBlock),
    `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:${MUTED_COLOR};">${escapeHtml(content.footer)}</p>`,
    `</td></tr></table>`,
    `</td></tr></table>`,
    `</body>`,
    `</html>`,
    ``,
  ].join("\n")
}
