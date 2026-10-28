/**
 * A person's display name, made safe to put in a greeting. Names are chosen
 * by the account holder, so they are treated as untrusted:
 * - control characters and bidirectional overrides (which can make text read
 *   differently from what it is) are removed and whitespace is collapsed;
 * - a name that looks like an address or a link (`@`, `://`, `www.`) is
 *   dropped, so neither the recipient's email nor a lookalike URL ends up in
 *   the body;
 * - anything longer than MAX_GREETING_NAME_LENGTH is cut.
 * Null means "greet without a name". HTML escaping is the renderer's job;
 * this function only decides which text is shown.
 */

export const MAX_GREETING_NAME_LENGTH = 60

const CONTROL_AND_BIDI = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g
const LINK_OR_ADDRESS = /@|:\/\/|\bwww\./i

export function greetingName(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null
  const cleaned = name.normalize("NFC").replace(CONTROL_AND_BIDI, " ").replace(/\s+/g, " ").trim()
  if (!cleaned || LINK_OR_ADDRESS.test(cleaned)) return null
  const characters = Array.from(cleaned)
  return characters.length > MAX_GREETING_NAME_LENGTH ? `${characters.slice(0, MAX_GREETING_NAME_LENGTH - 1).join("").trimEnd()}…` : cleaned
}
