import { createInterface } from "node:readline/promises"

/**
 * Reads a password for an operator command: from the named environment
 * variable of this invocation when set, otherwise from a hidden terminal
 * prompt. Never echoes the value and never logs it.
 */
export async function readOperatorPassword(variable: string, prompt: string): Promise<string> {
  const fromEnv = process.env[variable]
  if (fromEnv) return fromEnv
  if (!process.stdin.isTTY) {
    console.error(`No TTY: set ${variable} for this invocation.`)
    process.exit(1)
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const output = process.stdout
  const originalWrite = output.write.bind(output)
  // readline echoes typed characters through the output stream; let only the prompt through.
  output.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => (String(chunk).includes(prompt) ? originalWrite(chunk, ...(rest as [])) : true)) as typeof output.write
  try {
    const answer = await rl.question(prompt)
    originalWrite("\n")
    return answer
  } finally {
    output.write = originalWrite
    rl.close()
  }
}
