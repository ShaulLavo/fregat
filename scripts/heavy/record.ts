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
  /** The repository's main checkout (shared by its worktrees); null outside git. */
  readonly repo: string | null
  /** `cwd` relative to its checkout's root; empty at the root, null outside git. */
  readonly subdir: string | null
  readonly command: readonly string[]
  readonly host: string
  /** The admission class and its budget; null on the Pi, which runs under its own ceiling. */
  readonly class: string | null
  readonly estimateBytes: number | null
  readonly ceilingBytes: number | null
  /** Why admission let it start: the free memory it saw, or that nothing else ran. */
  readonly admission: string
  /** The local job slice; null for a Pi job. */
  readonly slice: string | null
  readonly quiet: boolean
  /** A quiet job stopped because its hold ran out; it has to queue again. */
  readonly quietHoldExpired: boolean
  readonly unit: string
  readonly queuedMs: number
  readonly wallMs: number
  readonly exitCode: number
  /** Null when the scope ended before its shim could read the cgroup (the whole scope was killed). */
  readonly memoryPeakBytes: number | null
  readonly cpuUsageUsec: number | null
  readonly oomKills: number | null
  readonly leftoverProcesses: number | null
}

export function appendRecord(logDir: string, record: HeavyJobRecord) {
  mkdirSync(logDir, { recursive: true })
  const day = record.timestamp.slice(0, 10)
  appendFileSync(path.join(logDir, `${day}.jsonl`), `${JSON.stringify(record)}\n`)
}

const REDACTED = '<redacted>'
const MAX_ARGUMENT = 1_000
const SECRET_NAME = /secret|token|passw|api[-_]?key|private[-_]?key|credential|auth/i
const SECRET_QUERY = /^(?:key|sig|signature)$/i
const SECRET_FLAG = new RegExp(`^--?[\\w-]*(?:${SECRET_NAME.source})[\\w-]*$`, 'i')
const ASSIGNMENT = /^(--?[\w-]+|[A-Za-z_]\w*)=([\s\S]*)$/
const HEADER = /^([\w-]+)\s*:\s*([\s\S]+)$/
const SHELL_WORD = /(?:[^\s'"\\;|&()<>]+|'[^']*'|"(?:[^"\\]|\\.)*"|\\.)+/g
const QUOTED = /'([^']*)'|"((?:[^"\\]|\\.)*)"|\\(.)/g
const URL_CREDENTIALS = /(\w+:\/\/)[^\s/@]+@/g
const URL_QUERY = /([?&;])([\w.%-]+)=([^&#\s'"]*)/g
const SECRET_SHAPES = [
  /\b(?:Bearer|Basic)\s+[^\s'"]+/gi,
  /\b(?:sk|pk|rk)-[\w-]{16,}/g,
  /\bgh[pousr]_\w{20,}/g,
  /\bxox[abprs]-[\w-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g,
  // Opaque mixed-case tokens; lowercase hex such as commit hashes stays readable.
  /\b(?=[\w-]*[a-z])(?=[\w-]*[A-Z])(?=[\w-]*\d)[\w-]{32,}\b/g,
]

/**
 * The command as it is safe to log. A secret-named assignment, flag value or header loses
 * its whole value; credential shapes, URL credentials and secret query parameters are
 * replaced wherever they appear; shell text is split into words and checked word by word.
 * Over-redaction is fine.
 */
export function redactCommand(command: readonly string[]): string[] {
  return command.map((argument, index) => cap(redactArgument(argument, command[index - 1])))
}

function redactArgument(argument: string, previous: string | undefined) {
  if (previous !== undefined && SECRET_FLAG.test(previous)) return REDACTED
  const named = redactNamed(argument)
  if (named !== null) return named
  return redactShapes(/\s/.test(argument) ? redactShellText(argument) : argument)
}

function redactNamed(word: string): string | null {
  const assignment = ASSIGNMENT.exec(word)
  if (assignment && SECRET_NAME.test(assignment[1]!)) return `${assignment[1]}=${REDACTED}`
  const header = HEADER.exec(word)
  if (header && SECRET_NAME.test(header[1]!)) return `${header[1]}: ${REDACTED}`
  return null
}

function redactShapes(text: string) {
  let out = text.replace(URL_CREDENTIALS, `$1${REDACTED}@`)
  out = out.replace(URL_QUERY, (whole, separator: string, name: string) =>
    SECRET_NAME.test(name) || SECRET_QUERY.test(name) ? `${separator}${name}=${REDACTED}` : whole,
  )
  for (const shape of SECRET_SHAPES) out = out.replace(shape, REDACTED)
  return out
}

function redactShellText(text: string) {
  const words = [...text.matchAll(SHELL_WORD)]
  let out = ''
  let cursor = 0
  for (const [index, word] of words.entries()) {
    const previous = words[index - 1]
    const replacement =
      previous && SECRET_FLAG.test(unquote(previous[0])) ? REDACTED : redactNamed(unquote(word[0]))
    if (replacement === null) continue
    out +=
      text.slice(cursor, word.index) + (/\s/.test(replacement) ? `'${replacement}'` : replacement)
    cursor = word.index + word[0].length
  }
  return out + text.slice(cursor)
}

function unquote(word: string) {
  return word.replace(
    QUOTED,
    (_, single?: string, double?: string, escaped?: string) =>
      single ?? double?.replace(/\\(.)/g, '$1') ?? escaped ?? '',
  )
}

function cap(text: string) {
  return text.length <= MAX_ARGUMENT ? text : `${text.slice(0, MAX_ARGUMENT - 1)}…`
}
