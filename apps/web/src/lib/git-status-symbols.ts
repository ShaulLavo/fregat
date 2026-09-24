import type { GitFileStatus } from '@workspace/contracts'
export type GitSymbolSource = 'staged' | 'worktree' | 'historical'

export type StatusPresentation = {
  className: string
  label: string
  title: string
}

// TODO(git): Add VS Code-style incoming/outgoing decorations such as "↓M"
// TODO(git): Support the full VS Code status alphabet: copied (C),
// TODO(git): Split staged/worktree theme colors like VS Code's
export function gitStatusSymbol(
  status: GitFileStatus['index'] | GitFileStatus['worktree'],
  source: GitSymbolSource,
): StatusPresentation {
  const change = gitChangeSymbol(status)
  const prefix = gitSourcePrefix(source)

  return {
    className: change.className,
    label: `${prefix}${change.label}`,
    title: `${gitSourceTitle(source)} ${change.title}`,
  }
}

function gitChangeSymbol(
  status: GitFileStatus['index'] | GitFileStatus['worktree'],
): StatusPresentation {
  if (status === 'added') {
    return { className: 'text-success', label: 'A', title: 'added' }
  }
  if (status === 'deleted') {
    return { className: 'text-destructive', label: 'D', title: 'deleted' }
  }
  if (status === 'ignored') {
    return { className: 'text-muted-foreground', label: 'I', title: 'ignored' }
  }
  if (status === 'renamed') {
    return { className: 'text-info', label: 'R', title: 'renamed' }
  }
  if (status === 'untracked') {
    return { className: 'text-success', label: 'U', title: 'untracked' }
  }
  if (status === 'conflicted') {
    return { className: 'text-destructive', label: '!', title: 'conflicted' }
  }

  return { className: 'text-warning', label: 'M', title: 'modified' }
}

function gitSourcePrefix(source: GitSymbolSource) {
  if (source === 'staged') return '+'
  if (source === 'worktree') return '*'

  return ''
}

function gitSourceTitle(source: GitSymbolSource) {
  if (source === 'staged') return 'Staged'
  if (source === 'worktree') return 'Unstaged'

  return 'Historical'
}

const CHECKPOINT_CHANGE_STATUSES = ['added', 'deleted', 'renamed'] as const

/** A checkpoint file's `kind` is an open string; anything unrecognized reads as modified. */
export function checkpointChangeStatus(kind: string): StatusPresentation {
  const status = CHECKPOINT_CHANGE_STATUSES.find((known) => known === kind) ?? 'modified'
  return gitStatusSymbol(status, 'historical')
}
