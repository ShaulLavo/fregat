export type Refusal = {
  readonly timestamp: string
  readonly code: string
  readonly origin: string | null
}

type RefusalScope = { readonly release: string | undefined; readonly since: string }

// Connections the new server refused. A tab from the previous release that lands on the connection
// gate logs one of these codes; the census budgets noise, so a single refusal would pass unseen.
import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const REFUSAL_CODES = ['ENVIRONMENT_IDENTITY_DRIFT', 'ENVIRONMENT_PROTOCOL_MISMATCH']
const RECENT_FILE_MS = 60 * 60 * 1000

/** Lines the server wrote for `release` (or since `since`) whose error is a refusal. */
export function refusedLogLines(lines: readonly string[], { release, since }: RefusalScope) {
  const found: Refusal[] = []
  for (const line of lines) {
    if (!REFUSAL_CODES.some((code) => line.includes(code))) continue
    const event = parseLine(line)
    if (!event) continue
    const code = event.error?.code ?? event.code
    if (!REFUSAL_CODES.includes(code)) continue
    if (release ? event.version !== release : event.timestamp < since) continue
    found.push({ timestamp: event.timestamp, code, origin: event.error?.internal?.origin ?? null })
  }
  return found
}

export function refusalFailures(refusals: readonly Refusal[], release: string | undefined) {
  const byCode = Object.groupBy(refusals, (refusal) => refusal.code)
  // The release in the text keeps a refusal fresh against the previous check's baseline.
  return Object.entries(byCode).map(
    ([code, items]) =>
      `refused connections on ${release ?? 'this release'}: ${items?.length ?? 0} ${code} since ${items?.[0]?.timestamp}`,
  )
}

export async function readRefusals(
  directory: string | undefined,
  { release, since }: RefusalScope,
) {
  if (!directory) return []
  const names = (await readdir(directory)).filter((name: string) => name.endsWith('.jsonl'))
  const found: Refusal[] = []
  for (const name of names) {
    const file = resolve(directory, name)
    if (Date.now() - (await stat(file)).mtimeMs > RECENT_FILE_MS) continue
    const lines = (await readFile(file, 'utf8')).split('\n')
    found.push(...refusedLogLines(lines, { release, since }))
  }
  return found.sort((left, right) => left.timestamp.localeCompare(right.timestamp))
}

function parseLine(line: string) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}
