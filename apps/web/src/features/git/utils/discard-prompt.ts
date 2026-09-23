import type { ChangeRow, DiscardRequest, PanelSection } from '@/features/git/utils/types'

export type DiscardPrompt = {
  readonly title: string
  readonly description: string
  readonly confirm: 'Delete' | 'Discard'
}

const IRREVERSIBLE = 'This cannot be undone.'

export function discardRequest(section: PanelSection, rows: readonly ChangeRow[]): DiscardRequest {
  return {
    section,
    paths: rows.map((row) => row.file.path),
    newFiles: rows.filter(isNewFile).length,
  }
}

/** `name` is the single file's display name; a many-file prompt ignores it. */
export function discardPrompt(request: DiscardRequest, name: string): DiscardPrompt {
  const staged = request.section === 'staged'
  if (request.paths.length === 1) return singleFilePrompt(request, name, staged)

  const count = request.paths.length
  const lost = staged ? 'Staged and unstaged changes to these files are lost. ' : ''
  return {
    title: `Discard all ${staged ? 'staged ' : ''}changes in ${count} files?`,
    description: `${lost}${newFilesSentence(request.newFiles)}${IRREVERSIBLE}`,
    confirm: 'Discard',
  }
}

function singleFilePrompt(request: DiscardRequest, name: string, staged: boolean): DiscardPrompt {
  if (request.newFiles === 1) {
    return {
      title: `Delete ${name}?`,
      description: `Git does not track this file yet, so discarding it deletes it. ${IRREVERSIBLE}`,
      confirm: 'Delete',
    }
  }
  if (staged) {
    return {
      title: `Discard staged changes in ${name}?`,
      description: `Its staged and unstaged changes are both lost. ${IRREVERSIBLE}`,
      confirm: 'Discard',
    }
  }

  return { title: `Discard changes in ${name}?`, description: IRREVERSIBLE, confirm: 'Discard' }
}

function newFilesSentence(count: number) {
  if (count === 0) return ''
  if (count === 1) return '1 new file is deleted. '

  return `${count} new files are deleted. `
}

// A staged-new file is untracked again once unstaged, so discard's clean step deletes it.
function isNewFile(row: ChangeRow) {
  return row.status === 'untracked' || row.status === 'added'
}
