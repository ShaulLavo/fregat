import { ColumnsIcon, RowsIcon, type Icon } from '@phosphor-icons/react'

import type { EditorDiffViewMode } from '@/features/editor/utils/diff-view-mode'
import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import { commitMessageFilePath } from '@/keymap/utils/commit-message-file'
import { isMarkdownPath } from '@/lib/markdown-mode/utils/mode'
import { commandIcons, platformCommand } from './table'
import type { PlatformCommandId } from './types'

/** What a title action may look at: the active tab, plus the view state its buttons reflect. */
export type EditorTitleContext = {
  readonly tab: EditorTabModel
  readonly diffViewMode: EditorDiffViewMode
}

type EditorTitlePresentation = { readonly icon: Icon; readonly label: string }

/**
 * A control in the editor title, shown for the tabs `when` accepts. It only
 * names a command: what it does, its palette entry and its key all stay in the
 * command table, so a title button is never the sole way to reach something.
 */
type EditorTitleAction = {
  readonly command: PlatformCommandId
  readonly when: (context: EditorTitleContext) => boolean
  /** For a toggle, whose icon and label say where it goes; defaults to the command's own. */
  readonly present?: (context: EditorTitleContext) => EditorTitlePresentation
}

export type ResolvedEditorTitleAction = EditorTitlePresentation & {
  readonly command: PlatformCommandId
}

const EDITOR_TITLE_ACTIONS: readonly EditorTitleAction[] = [
  { command: 'workspace.acceptCommitMessage', when: isCommitMessageTab },
  { command: 'workspace.discardCommitMessage', when: isCommitMessageTab },
  { command: 'editor.merge-conflict.previous', when: ({ tab }) => tab.mergeConflicts },
  { command: 'editor.merge-conflict.next', when: ({ tab }) => tab.mergeConflicts },
  { command: 'workspace.toggleDiffViewMode', present: diffViewModeToggle, when: isDiffTab },
  { command: 'workspace.cycleMarkdownView', when: isMarkdownFileTab },
]

export function editorTitleActions(
  context: EditorTitleContext,
): readonly ResolvedEditorTitleAction[] {
  const resolved: ResolvedEditorTitleAction[] = []
  for (const action of EDITOR_TITLE_ACTIONS) {
    if (!action.when(context)) continue

    const presentation = action.present?.(context) ?? commandPresentation(action.command)
    if (presentation) resolved.push({ ...presentation, command: action.command })
  }

  return resolved
}

function commandPresentation(command: PlatformCommandId): EditorTitlePresentation | null {
  const entry = platformCommand(command)
  const icon = commandIcons[command]
  if (!entry || !icon) return null

  return { icon, label: entry.title }
}

function isCommitMessageTab({ tab }: EditorTitleContext) {
  if (tab.content.kind !== 'document') return false

  return commitMessageFilePath(tab.content.document) !== null
}

function isDiffTab({ tab }: EditorTitleContext) {
  if (tab.content.kind !== 'document') return false

  const { kind } = tab.content.document
  return kind === 'git-diff' || kind === 'compare-saved'
}

function isMarkdownFileTab({ tab }: EditorTitleContext) {
  if (tab.content.kind !== 'document' || tab.content.document.kind !== 'file') return false

  return isMarkdownPath(tab.content.document.resource.path)
}

function diffViewModeToggle({ diffViewMode }: EditorTitleContext): EditorTitlePresentation {
  if (diffViewMode === 'split') return { icon: RowsIcon, label: 'Switch to stacked diff' }

  return { icon: ColumnsIcon, label: 'Switch to split diff' }
}
