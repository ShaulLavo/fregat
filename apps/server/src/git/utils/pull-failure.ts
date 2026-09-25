import { sanitizeErrorMessage } from '../../observability/sanitize-message'
import type { GitCommandResult } from '../types'

const listedConflicts = 3

/** Names the first few conflicted files; a rebase of many commits can conflict in dozens. */
export function conflictSummary(files: readonly string[]) {
  const named = files.slice(0, listedConflicts).join(', ')
  const rest = files.length - listedConflicts
  return rest > 0 ? `${named} and ${rest} more` : named
}

/** The line git uses to say why it refused, without its `fatal:`/`error:` prefix. */
export function pullFailureReason(result: GitCommandResult) {
  const lines = `${result.stderr}\n${result.stdout}`.split(/[\r\n]+/)
  const line = lines.find((entry) => /^(fatal|error):/.test(entry))
  if (!line) return `exited with code ${result.exitCode}`
  return sanitizeErrorMessage(line.replace(/^(fatal|error):\s*/, ''))
}
