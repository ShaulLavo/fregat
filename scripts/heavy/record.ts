import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** One finished heavy job, as one line of `<logDir>/<UTC date>.jsonl`. */
export type HeavyJobRecord = {
  readonly timestamp: string
  readonly level: 'info' | 'warn'
  readonly source: 'heavy'
  readonly area: 'heavy-jobs'
  readonly action: 'heavy.job'
  /** The job id; also names its scope unit. */
  readonly requestId: string
  readonly version: string
  readonly commitHash: string
  readonly label: string
  readonly cwd: string
  readonly command: readonly string[]
  readonly host: string
  readonly slot: number
  readonly unit: string
  readonly queuedMs: number
  readonly wallMs: number
  readonly exitCode: number
  /** Null when the scope ended before its shim could read the cgroup (the whole scope was killed). */
  readonly memoryPeakBytes: number | null
  readonly cpuUsageUsec: number | null
  readonly oomKills: number | null
}

export function appendRecord(logDir: string, record: HeavyJobRecord) {
  mkdirSync(logDir, { recursive: true })
  const day = record.timestamp.slice(0, 10)
  appendFileSync(path.join(logDir, `${day}.jsonl`), `${JSON.stringify(record)}\n`)
}

const REDACTED = '<redacted>'
const MAX_ARGUMENT = 1_000
const SECRET_NAME = /secret|token|passw|api[-_]?key|private[-_]?key|credential|auth/i
const SECRET_FLAG = new RegExp(`^--?[\\w-]*(?:${SECRET_NAME.source})[\\w-]*$`, 'i')
const ASSIGNMENTS = /(--?[\w-]+|\b[A-Za-z_][\w]*)([=:]\s*)(\S+)/g
const SECRET_SHAPES = [
  /\b(?:Bearer|Basic)\s+\S+/gi,
  /\b(?:sk|pk|rk)-[\w-]{16,}/g,
  /\bgh[pousr]_\w{20,}/g,
  /\bxox[abprs]-[\w-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
]

/**
 * The command as it is safe to log: values of secret-named variables and flags, bearer
 * tokens, URL credentials and well-known key shapes are replaced. Over-redaction is fine.
 */
export function redactCommand(command: readonly string[]): string[] {
  return command.map((argument, index) => {
    if (index > 0 && SECRET_FLAG.test(command[index - 1]!)) return REDACTED
    return cap(redactText(argument))
  })
}

function redactText(text: string) {
  let out = text.replace(/(\w+:\/\/)[^\s/@]+@/g, `$1${REDACTED}@`)
  for (const shape of SECRET_SHAPES) out = out.replace(shape, REDACTED)
  return out.replace(ASSIGNMENTS, (whole, name: string, joiner: string) =>
    SECRET_NAME.test(name) ? `${name}${joiner}${REDACTED}` : whole,
  )
}

function cap(text: string) {
  return text.length <= MAX_ARGUMENT ? text : `${text.slice(0, MAX_ARGUMENT - 1)}…`
}
