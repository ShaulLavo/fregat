import {
  ArrowSquareOutIcon,
  BracketsCurlyIcon,
  ClockCounterClockwiseIcon,
  CodeBlockIcon,
  CodeIcon,
  ColumnsPlusRightIcon,
  CommandIcon,
  CursorTextIcon,
  EyeIcon,
  FloppyDiskIcon,
  GitDiffIcon,
  GitForkIcon,
  ListMagnifyingGlassIcon,
  MagicWandIcon,
  PencilSimpleIcon,
} from '@phosphor-icons/react'

import { commandItem, section, type Menu } from '@/keymap/menus/utils/model'

/**
 * The menu for a right-click inside editor text.
 *
 * Every item is a registered Platform command, so availability comes from the
 * same target capabilities and command conditions the command palette uses.
 * Navigation remains available on read-only diffs and search results, while
 * text-edit commands require a writable editor.
 *
 * These commands act on the caret and selection, not on the point that was
 * right-clicked — the editor ignores non-primary mouse buttons when it maps a
 * click to a text offset (`inputSelectionController.handleMouseDown` guards on
 * `event.button !== 0`), so a right-click never moves the caret. That makes the
 * menu a mirror of the keyboard shortcuts at that moment, which is why it
 * carries no item that names a specific line or token.
 */
export function editorTextMenu(): Menu {
  return [
    section('navigate', [
      commandItem('editor.goToDefinition', {
        icon: ArrowSquareOutIcon,
        label: 'Go to Definition',
      }),
      commandItem('editor.editor.action.goToTypeDefinition', {
        icon: BracketsCurlyIcon,
        label: 'Go to Type Definition',
      }),
      commandItem('editor.editor.action.goToImplementation', {
        icon: GitForkIcon,
        label: 'Go to Implementations',
      }),
      commandItem('editor.editor.action.goToReferences', {
        icon: ListMagnifyingGlassIcon,
        label: 'Find All References',
      }),
      commandItem('editor.editor.action.peekDefinition', {
        icon: EyeIcon,
        label: 'Peek Definition',
      }),
      commandItem('editor.editor.action.revealDefinitionAside', {
        icon: ColumnsPlusRightIcon,
        label: 'Open Definition to the Side',
      }),
    ]),
    section('edit', [
      commandItem('editor.editor.action.changeAll', {
        icon: CursorTextIcon,
        label: 'Change All Occurrences',
      }),
      commandItem('editor.editor.action.commentLine', {
        icon: CodeIcon,
        label: 'Toggle Line Comment',
      }),
      commandItem('editor.editor.action.blockComment', {
        icon: CodeBlockIcon,
        label: 'Toggle Block Comment',
      }),
      commandItem('editor.editor.action.rename', {
        icon: PencilSimpleIcon,
        label: 'Rename Symbol',
      }),
      commandItem('editor.editor.action.formatDocument', {
        icon: MagicWandIcon,
        label: 'Format Document',
      }),
    ]),
    // Acts on the active editor, the same surface the caret commands above target —
    // a right-click never moves the caret or the active tab.
    //
    // Revert File is deliberately not here. Unlike VS Code's, our revert rebuilds
    // the buffer and so discards undo history (workspace-document-service
    // replacementRecord), making it unrecoverable; it stays in the palette, where
    // running it is a deliberate act rather than a misclick.
    section('file', [
      commandItem('workspace.saveFile', {
        icon: FloppyDiskIcon,
        label: 'Save',
      }),
      commandItem('workspace.compareWithSaved', {
        icon: GitDiffIcon,
        label: 'Compare with Saved',
      }),
      commandItem('workspace.openFileAtHead', {
        icon: ClockCounterClockwiseIcon,
        label: 'Open File at HEAD',
      }),
    ]),
    section('palette', [
      commandItem('workspace.showCommandPalette', {
        icon: CommandIcon,
        label: 'Command Palette…',
      }),
    ]),
  ]
}
