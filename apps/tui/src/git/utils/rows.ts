import { gitStatusRows } from '@workspace/client-core/git/status-rows'
import type { GitFileStatus } from '@workspace/contracts'
import type { DiffRenderRow } from '@singapore-editor/diff'
import type { Theme } from '@/theme/utils/theme'

export type GitRow = {
  name: string
  description: string
  value: { file: GitFileStatus; staged: boolean }
}
export function gitRows(files: readonly GitFileStatus[]): GitRow[] {
  const { staged, worktree } = gitStatusRows(files)
  return [
    ...staged.map((file) => gitRow(file, true)),
    ...worktree.map((file) => gitRow(file, false)),
  ]
}
function gitRow(file: GitFileStatus, staged: boolean): GitRow {
  const group = staged ? 'Staged' : 'Changes'
  return {
    name: `${group} · ${file.path}`,
    description: staged ? file.index : file.worktree,
    value: { file, staged },
  }
}
export function diffRowColor(row: DiffRenderRow, theme: Theme) {
  if (row.type === 'addition') return theme.diffAdded
  if (row.type === 'deletion') return theme.diffRemoved
  if (row.type === 'hunk') return theme.info
  return theme.foreground
}
export function diffRowText(row: DiffRenderRow, side: 'old' | 'new' | 'stacked') {
  if (row.type === 'hunk') return `${row.expanded ? '▾' : '▸'} ${row.text}`
  if (row.type === 'placeholder') return ''
  const number = side === 'old' ? row.oldLineNumber : (row.newLineNumber ?? row.oldLineNumber)
  let marker = ' '
  if (row.type === 'addition') marker = '+'
  if (row.type === 'deletion') marker = '−'
  return `${String(number ?? '').padStart(5)} ${marker} ${row.text.replaceAll('\t', '    ')}`
}
