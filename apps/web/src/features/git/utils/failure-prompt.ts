import { ansiSpans } from '@/features/git/utils/ansi-spans'

export type GitFailure = {
  /** The mutation key's operation segment, such as `push` or `stage-many`. */
  readonly operation: string
  readonly message: string
}

const OPERATION_LABELS: Readonly<Record<string, string>> = {
  'create-branch': 'Create branch',
  'create-pull-request': 'Create pull request',
  'discard-many': 'Discard',
  'discard-staged-many': 'Discard staged',
  'stage-many': 'Stage',
  'unstage-many': 'Unstage',
}

// Hook output can be a whole test run; the tail is where the verdict is.
const MAX_OUTPUT_LINES = 120

export function gitFailureLabel(operation: string) {
  const label = OPERATION_LABELS[operation]
  if (label) return label

  return `${operation.charAt(0).toUpperCase()}${operation.slice(1)}`
}

/** What the agent is asked: the step that failed, git's message, and any hook output. */
export function gitFailurePrompt(
  failure: GitFailure,
  rootPath: string,
  outputLines: readonly string[],
) {
  const lines = [
    `Git ${gitFailureLabel(failure.operation).toLowerCase()} failed in ${rootPath || 'this repository'}.`,
    '',
    `Error: ${failure.message}`,
  ]
  const output = outputLines.map(plainText).filter((line) => line.trim().length > 0)
  if (output.length > 0) lines.push('', 'Output:', '```', ...output.slice(-MAX_OUTPUT_LINES), '```')
  lines.push('', 'Find the cause and fix it so the same step succeeds.')

  return lines.join('\n')
}

function plainText(line: string) {
  return ansiSpans(line)
    .map((span) => span.text)
    .join('')
}
