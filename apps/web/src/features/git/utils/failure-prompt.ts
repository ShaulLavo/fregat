import { ansiSpans } from '@/lib/ansi-spans'

export type GitFailure = {
  /** The mutation key's operation segment, such as `push` or `stage-many`. */
  readonly operation: string
  readonly message: string
}

const OPERATION_LABELS: Readonly<Record<string, string>> = {
  'create-branch': 'Create branch',
  'create-pull-request': 'Create pull request',
  'discard-staged': 'Discard staged',
  'init-submodules': 'Initialize submodules',
  publish: 'Publish repository',
  'stage-many': 'Stage',
  sync: 'Pull and push',
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
    `Fix the Git ${gitFailureLabel(failure.operation).toLowerCase()} failure in ${rootPath || 'this repository'}.`,
    '',
    `Error: ${failure.message}`,
  ]
  const output = outputLines.map(plainText).filter((line) => line.trim().length > 0)
  if (output.length > 0) lines.push('', 'Output:', '```', ...output.slice(-MAX_OUTPUT_LINES), '```')

  return lines.join('\n')
}

function plainText(line: string) {
  return ansiSpans(line)
    .map((span) => span.text)
    .join('')
}
