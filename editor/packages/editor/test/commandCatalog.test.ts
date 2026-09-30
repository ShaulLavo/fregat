import { describe, expect, it } from 'vitest'
import baseline from './fixtures/keymap-bindings.baseline.json'
import { EDITOR_COMMANDS } from '../src/editor/commandCatalog'
import {
  defaultEditorKeyBindings,
  editorCommandPackForCommand,
  readonlySafeEditorCommandPacks,
  vscodeEditorKeyBindings,
} from '../src/keymap/presets'

describe('editor command catalog', () => {
  it('declares every command once', () => {
    const ids = EDITOR_COMMANDS.map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never puts a command that changes the document in a pack a readonly view keeps', () => {
    const readonlySafe = new Set<string>(readonlySafeEditorCommandPacks)
    const leaking = EDITOR_COMMANDS.filter(
      (command) =>
        command.mutates && readonlySafe.has(editorCommandPackForCommand(command.id) ?? ''),
    )
    expect(leaking.map((command) => command.id)).toEqual([])
  })

  it('gives every command a title', () => {
    expect(EDITOR_COMMANDS.filter((command) => command.title.trim() === '')).toEqual([])
  })

  // Captured from the hand-kept pack lists the catalog replaced: moving facts must not rebind a key.
  it('binds the same keys as before the catalog', () => {
    for (const platform of ['linux', 'mac', 'windows'] as const) {
      expect(JSON.parse(JSON.stringify(defaultEditorKeyBindings(platform)))).toEqual(
        baseline[`default:${platform}`],
      )
      expect(JSON.parse(JSON.stringify(vscodeEditorKeyBindings(platform)))).toEqual(
        baseline[`vscode:${platform}`],
      )
    }
  })
})
