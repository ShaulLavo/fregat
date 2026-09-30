import { expect, test } from 'vitest'
import * as keymap from '@singapore-editor/core/keymap'
import { defaultEditorKeyBindings, vscodeEditorKeyBindings } from '../src/keymap/presets'

test('built public keymap entry imports without DOM and contains distinct complete packs', () => {
  expect(typeof document).toBe('undefined')
  expect(keymap.createKeymapRuntime).toBeTypeOf('function')
  for (const platform of ['mac', 'windows', 'linux'] as const) {
    const defaults = keymap.defaultEditorKeyBindings(platform)
    const vscode = keymap.vscodeEditorKeyBindings(platform)
    expect(defaults).toEqual(defaultEditorKeyBindings(platform))
    expect(vscode).toEqual(vscodeEditorKeyBindings(platform))
    expect(defaults).not.toEqual(vscode)
    expect(defaults.some((binding) => binding.chord.length === 2)).toBe(true)
    expect(keymap.editorCommandPackForCommand('editor.action.showHover')).toBe('lsp-navigation')
    expect(
      defaults.every(
        (binding) =>
          !keymap.editorCommandMutates(binding.command) || binding.when?.includes('writable'),
      ),
    ).toBe(true)
  }
})
