import { diffLines } from 'diff'

import type { AgentDiagnostic } from '../../lsp/agent-diagnostics'

/** The caps Claude Code's own LSP attachment uses. */
const PER_FILE_LIMIT = 10
const CHARACTER_LIMIT = 4_000

/** Subtract old occurrences at their edit-adjusted lines, preserving duplicate locations. */
export function newErrors(
  before: readonly AgentDiagnostic[],
  after: readonly AgentDiagnostic[],
  source: { beforeText: string; afterText: string; timeoutMs: number },
): AgentDiagnostic[] {
  if (source.timeoutMs <= 0) return []
  const deadline = performance.now() + source.timeoutMs
  const lines = unchangedLines(source)
  if (!lines) return []
  const remaining = new Map<string, number>()
  for (const error of before) {
    const line = lines.get(error.line)
    if (line === undefined) continue
    const key = errorKey({ ...error, line })
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  const introduced: AgentDiagnostic[] = []
  for (const error of after) {
    const left = remaining.get(errorKey(error)) ?? 0
    if (left > 0) {
      remaining.set(errorKey(error), left - 1)
      continue
    }
    introduced.push(error)
  }
  return performance.now() < deadline ? introduced : []
}

/** What the agent reads after its edit; null when there is nothing new to say. */
export function diagnosticsFeedback(displayPath: string, errors: readonly AgentDiagnostic[]) {
  if (errors.length === 0) return null
  const shown = errors.slice(0, PER_FILE_LIMIT)
  const lines = shown.map(
    (error) => `- line ${error.line}: ${error.message}${error.code ? ` (${error.code})` : ''}`,
  )
  const more = errors.length - shown.length
  if (more > 0) lines.push(`- and ${more} more`)
  const noun = errors.length === 1 ? 'error' : 'errors'
  const text = [
    '<new-diagnostics>',
    `Your edit to ${displayPath} introduced ${errors.length} ${noun}:`,
  ]
    .concat(lines, ['</new-diagnostics>'])
    .join('\n')
  return text.length <= CHARACTER_LIMIT ? text : `${text.slice(0, CHARACTER_LIMIT - 1)}…`
}

function errorKey(error: AgentDiagnostic) {
  return `${error.line}\u0000${error.code ?? ''}\u0000${error.message}`
}

function unchangedLines(source: { beforeText: string; afterText: string; timeoutMs: number }) {
  const changes = diffLines(source.beforeText, source.afterText, { timeout: source.timeoutMs })
  if (!changes) return null
  const lines = new Map<number, number>()
  let beforeLine = 1
  let afterLine = 1
  for (const change of changes) {
    if (!change.added && !change.removed) mapLineRange(lines, beforeLine, afterLine, change.count)
    if (!change.added) beforeLine += change.count
    if (!change.removed) afterLine += change.count
  }
  return lines
}

function mapLineRange(
  lines: Map<number, number>,
  beforeLine: number,
  afterLine: number,
  count: number,
) {
  for (let offset = 0; offset < count; offset += 1)
    lines.set(beforeLine + offset, afterLine + offset)
}
