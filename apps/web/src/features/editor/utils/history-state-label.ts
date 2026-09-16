import type { EditorHistoryGraphNode } from '@singapore-editor/core'

const INTENT_LABELS: Record<string, string> = {
  'insert-text': 'Typed',
  backspace: 'Backspace',
  delete: 'Delete',
  indent: 'Indent',
  outdent: 'Outdent',
  'programmatic-edit': 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  checkout: 'Restore',
}

export function historyStateSummary(node: EditorHistoryGraphNode): string {
  const transaction = node.transaction
  if (!transaction) return 'Opened'
  const label = INTENT_LABELS[transaction.metadata.intent] ?? transaction.metadata.intent
  const delta = historyStateDelta(node)
  if (delta === 0) return label
  return `${label} ${delta > 0 ? '+' : ''}${delta}`
}

export function historyStateDelta(node: EditorHistoryGraphNode): number {
  const edits = node.transaction?.edits ?? []
  return edits.reduce((total, edit) => total + edit.text.length - (edit.to - edit.from), 0)
}

export function historyStateSource(node: EditorHistoryGraphNode): string | null {
  const source = node.transaction?.metadata.source
  if (!source || source === 'keyboard') return null
  return source
}

// The first non-blank line the edit inserted; a pure removal has nothing to show.
export function historyStateExcerpt(node: EditorHistoryGraphNode): string | null {
  for (const edit of node.transaction?.edits ?? []) {
    const line = edit.text.split('\n').find((candidate) => candidate.trim().length > 0)
    if (line !== undefined) return line.trim()
  }
  return null
}

export function relativeTimeLabel(committedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - committedAt) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

export function historyStateLabel(node: EditorHistoryGraphNode, now: number): string {
  const parts = [historyStateSummary(node), relativeTimeLabel(node.committedAt, now)]
  if (node.isCurrent) parts.push('current')
  return parts.join(', ')
}
