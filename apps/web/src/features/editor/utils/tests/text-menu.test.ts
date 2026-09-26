import { tabId } from '@/lib/documents/utils/identity'
import { testDocumentRef } from '../../../../../test/factories/document-targets'
import { editorTextMenu } from '@/features/editor/utils/text-menu'
import { spellingMenuSection } from '@/features/editor/utils/spelling-menu'
import type { MenuCommandItem } from '@/keymap/menus/utils/model'
import { platformCommand } from '@/keymap/table'
import type { PlatformCommandId } from '@/keymap/types'
import {
  commandWhenDisabledReason,
  commandWhenDisabledReasons,
  type CommandWhenSnapshot,
  type CommandWhenTarget,
} from '@/keymap/utils/when'
import { expect, test } from '../../../../../test/fixtures'

const OPEN_FILE_SNAPSHOT: CommandWhenSnapshot = {
  activeDocument: testDocumentRef('/repo/src/app.ts'),
  activeDocumentSavable: true,
  activeTabId: tabId('tab-1'),
  chatMode: false,
  workspaceOpen: true,
}

test('sections run navigate, chat, edit, file, then palette', () => {
  expect(editorTextMenu().map((entry) => entry.id)).toEqual([
    'navigate',
    'chat',
    'edit',
    'file',
    'palette',
  ])
})

test('a misspelled word leads the menu with its replacements and the dictionaries', () => {
  const replaced: string[] = []
  const accepted: string[] = []
  const spelling = spellingMenuSection({
    word: 'befor',
    suggestions: ['before', 'befog'],
    hasWorkspace: true,
    replace: (word) => replaced.push(word),
    accept: (target) => accepted.push(target),
  })
  const menu = editorTextMenu(spelling)
  expect(menu[0]?.id).toBe('spelling')
  const items = (menu[0]?.items ?? []).filter((item) => item !== null && item !== false)
  expect(items.map((item) => ('label' in item ? item.label : null))).toEqual([
    'before',
    'befog',
    'Add to Dictionary',
    'Add to Workspace Dictionary',
  ])
  for (const item of items) if (item.kind === 'action') item.run()
  expect(replaced).toEqual(['before', 'befog'])
  expect(accepted).toEqual(['user', 'workspace'])
})

test('the spelling section says when suggestions are pending or there are none', () => {
  const section = (suggestions: readonly string[] | null) =>
    spellingMenuSection({
      word: 'qqzx',
      suggestions,
      hasWorkspace: false,
      replace: () => undefined,
      accept: () => undefined,
    })
      .items.filter((item) => item !== null && item !== false)
      .map((item) => ('label' in item ? item.label : null))
  expect(section(null)).toEqual(['Finding suggestions…', 'Add to Dictionary'])
  expect(section([])).toEqual(['No suggestions for “qqzx”', 'Add to Dictionary'])
})

test('the chat section hands the selection or the file to the composer', () => {
  expect(labels('chat')).toEqual(['Add Selection to Chat', 'Add File to Chat'])
})

// Revert File is intentionally absent: our revert rebuilds the buffer and discards undo history,
// so it stays in the palette rather than one misclick away.
test('the file section offers Save and not Revert', () => {
  expect(labels('file')).toEqual(['Save', 'Compare with Saved', 'Open File at HEAD'])
})

test('the navigate section leads with the definition jumps, then the wider searches', () => {
  expect(labels('navigate')).toEqual([
    'Go to Definition',
    'Go to Type Definition',
    'Go to Implementations',
    'Find All References',
    'Peek Definition',
    'Open Definition to the Side',
  ])
})

test('the edit section offers occurrences before the two comment toggles', () => {
  expect(labels('edit')).toEqual([
    'Change All Occurrences',
    'Toggle Line Comment',
    'Toggle Block Comment',
    'Rename Symbol',
    'Format Document',
  ])
})

test('the palette section is the single escape hatch to every other command', () => {
  expect(labels('palette')).toEqual(['Command Palette…'])
})

test('every item runs a command rather than a local callback', () => {
  expect(items().every((item) => item.kind === 'command')).toBe(true)
})

test('every item resolves through the platform command registry', () => {
  expect(items().every((item) => platformCommand(item.command) !== null)).toBe(true)
})

test('the navigate and edit items route to the editor command handlers', () => {
  expect(commands('navigate')).toEqual([
    'editor.goToDefinition',
    'editor.editor.action.goToTypeDefinition',
    'editor.editor.action.goToImplementation',
    'editor.editor.action.goToReferences',
    'editor.editor.action.peekDefinition',
    'editor.editor.action.revealDefinitionAside',
  ])
  expect(commands('edit')).toEqual([
    'editor.editor.action.changeAll',
    'editor.editor.action.commentLine',
    'editor.editor.action.blockComment',
    'editor.editor.action.rename',
    'editor.editor.action.formatDocument',
  ])
})

test('nothing is a placeholder for a feature that does not exist', () => {
  expect(items().filter((item) => item.unavailable)).toEqual([])
})

test('read-only editor targets allow navigation and occurrence selection but reject text edits', () => {
  const target = { kind: 'editor', writable: false } satisfies CommandWhenTarget

  expect(commands('navigate').map((command) => disabledReason(command, target))).toEqual([
    null,
    null,
    null,
    null,
    null,
    null,
  ])
  expect(commands('edit').map((command) => disabledReason(command, target))).toEqual([
    null,
    commandWhenDisabledReasons.editorWritable,
    commandWhenDisabledReasons.editorWritable,
    commandWhenDisabledReasons.editorWritable,
    commandWhenDisabledReasons.editorWritable,
  ])
})

test('the palette item survives a workspace with nothing open', () => {
  const snapshot: CommandWhenSnapshot = {
    activeDocument: null,
    activeDocumentSavable: false,
    activeTabId: null,
    chatMode: false,
    workspaceOpen: false,
  }

  expect(disabledReason('workspace.showCommandPalette', { kind: 'workspace' }, snapshot)).toBeNull()
})

function items(): readonly MenuCommandItem[] {
  return editorTextMenu().flatMap((entry) => entry.items.filter(Boolean) as MenuCommandItem[])
}

function sectionItems(sectionId: string): readonly MenuCommandItem[] {
  const entry = editorTextMenu().find((candidate) => candidate.id === sectionId)

  return (entry?.items ?? []).filter(Boolean) as MenuCommandItem[]
}

function labels(sectionId: string) {
  return sectionItems(sectionId).map((item) => item.label)
}

function commands(sectionId: string) {
  return sectionItems(sectionId).map((item) => item.command)
}

function disabledReason(
  commandId: PlatformCommandId,
  target: CommandWhenTarget,
  snapshot: CommandWhenSnapshot = OPEN_FILE_SNAPSHOT,
) {
  const command = platformCommand(commandId)
  if (!command) return 'Command is not registered.'

  return commandWhenDisabledReason(command.when, snapshot, target)
}
