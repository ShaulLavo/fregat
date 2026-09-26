import type { AgentDiagnostic } from '../../lsp/agent-diagnostics'

/** The caps Claude Code's own LSP attachment uses. */
const PER_FILE_LIMIT = 10
const CHARACTER_LIMIT = 4_000

/** Errors in `after` that `before` did not have, matched by code and message, as a multiset. */
export function newErrors(
  before: readonly AgentDiagnostic[],
  after: readonly AgentDiagnostic[],
): AgentDiagnostic[] {
  const remaining = new Map<string, number>()
  for (const error of before)
    remaining.set(errorKey(error), (remaining.get(errorKey(error)) ?? 0) + 1)
  const introduced: AgentDiagnostic[] = []
  for (const error of after) {
    const left = remaining.get(errorKey(error)) ?? 0
    if (left > 0) {
      remaining.set(errorKey(error), left - 1)
      continue
    }
    introduced.push(error)
  }
  return introduced
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
    ...lines,
    '</new-diagnostics>',
  ].join('\n')
  return text.length <= CHARACTER_LIMIT ? text : `${text.slice(0, CHARACTER_LIMIT - 1)}…`
}

function errorKey(error: AgentDiagnostic) {
  return `${error.code ?? ''}\u0000${error.message}`
}
