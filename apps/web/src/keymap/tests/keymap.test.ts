import { bindingsForInput, compileKeymap, createKeyInput, parseKeyContext } from '@fregat/hotkeys'
import { expect, test } from '../../../test/fixtures'
import { binding } from '../../../test/factories/key-binding'
import { keyBindingResolution, resolvedPlatformKeyBindings } from '@/keymap/active-bindings'
import { defaultPlatformKeyBindings, presetPlatformKeyBindings } from '@/keymap/default-bindings'
import { editorCommandIdFromPlatform } from '@/keymap/editor-keymap'
import ours from '@/keymap/presets/ours.json'
import zed from '@/keymap/presets/zed.json'

function selected(
  entries: ReturnType<typeof resolvedPlatformKeyBindings>,
  context: readonly string[],
) {
  const compiled = compileKeymap(
    entries.map(({ entry }) => entry),
    'linux',
  )
  return bindingsForInput(
    compiled,
    [createKeyInput({ key: 'B', modifiers: { ctrl: true } })],
    context.map(parseKeyContext),
  ).bindings.map(({ command }) => command)
}

test('ours preserves the pinned translation apart from the approved four document-navigation rows', () => {
  expect(ours.filter((row) => !('deviation' in row))).toEqual(
    zed.filter(
      (row) =>
        !(row.context === 'Editor' && ['Ctrl+[', 'Ctrl+]', 'Meta+[', 'Meta+]'].includes(row.keys)),
    ),
  )
  const deviations = ours.filter((row) => 'deviation' in row)
  expect(deviations).toHaveLength(4)
  expect(deviations.map((row) => row.command)).toEqual([
    'workspace.navigateBack',
    'workspace.navigateForward',
    'workspace.navigateBack',
    'workspace.navigateForward',
  ])
  const oursPreset = presetPlatformKeyBindings('linux', 'ours')
  expect(oursPreset.unmapped.length).toBeGreaterThan(0)
  expect(oursPreset.unmapped[0]).toMatchObject({
    platform: 'linux',
    context: expect.any(String),
    command: expect.any(String),
  })
})

test('the default editor layer leaves sidebar and history keys with the Workspace', () => {
  const bindings = defaultPlatformKeyBindings('linux', 'ours')
  expect(selected(bindings, ['Workspace', 'Editor mode=full writable markdown'])).toContain(
    'workspace.toggleSidebarVisibility',
  )
  expect(
    bindings.some(({ entry }) => 'command' in entry && entry.command === 'markdown.bold'),
  ).toBe(false)
  expect(editorCommandIdFromPlatform('editor.action.goToDefinition')).toBe(
    'editor.action.goToDefinition',
  )
  expect(editorCommandIdFromPlatform('editor.undo')).toBe('undo')
})

test('generic Editor preset rows exclude widget fields while explicit Find rows remain', () => {
  for (const preset of ['ours', 'zed', 'vscode'] as const) {
    const bindings = defaultPlatformKeyBindings('linux', preset)
    const compiled = compileKeymap(
      bindings.map(({ entry }) => entry),
      'linux',
    )
    const stack = ['Workspace', 'Editor writable', 'EditorWidget FindWidget'].map(parseKeyContext)
    for (const input of [
      createKeyInput({ key: 'Backspace' }),
      createKeyInput({ key: 'A', modifiers: { ctrl: true } }),
      createKeyInput({ key: 'Z', modifiers: { ctrl: true } }),
    ])
      expect(
        bindingsForInput(compiled, [input], stack).bindings.filter(({ command }) =>
          command === null ? false : editorCommandIdFromPlatform(command) !== null,
        ),
      ).toEqual([])
    expect(
      bindingsForInput(compiled, [createKeyInput({ key: 'Escape' })], stack).bindings.map(
        (row) => row.command,
      ),
    ).toContain('closeFind')
  }
})

test('a deeper default remains ahead of a user binding on the Workspace', () => {
  const defaults = [
    binding('Ctrl+B', { command: 'workspace.toggleSidebarVisibility', context: 'Workspace' }),
    binding('Ctrl+B', { command: 'editor.selectAll', context: 'Editor' }),
  ]
  const bindings = resolvedPlatformKeyBindings(
    defaults,
    [{ keys: 'Ctrl+B', command: 'workspace.saveFile', context: 'Workspace' }],
    'linux',
  )
  expect(selected(bindings, ['Workspace', 'Editor'])).toEqual([
    'selectAll',
    'workspace.saveFile',
    'workspace.toggleSidebarVisibility',
  ])
  const report = keyBindingResolution(
    defaults,
    [{ keys: 'Ctrl+B', command: 'workspace.saveFile', context: 'Workspace' }],
    'linux',
  ).report
  expect(report).toContainEqual(
    expect.objectContaining({
      command: 'workspace.toggleSidebarVisibility',
      winner: 'workspace.saveFile',
      reason: 'shadowed',
    }),
  )
})

test('same-depth users win, targeted unbind keeps a different command, and null reserves keys', () => {
  const defaults = [
    binding('Ctrl+B', { command: 'workspace.toggleSidebarVisibility', context: 'Workspace' }),
    binding('Ctrl+B', { command: 'workspace.saveFile', context: 'Workspace' }),
  ]
  expect(
    selected(
      resolvedPlatformKeyBindings(
        defaults,
        [{ keys: 'Ctrl+B', command: 'workspace.showSettings', context: 'Workspace' }],
        'linux',
      ),
      ['Workspace'],
    )[0],
  ).toBe('workspace.showSettings')
  expect(
    selected(
      resolvedPlatformKeyBindings(
        defaults,
        [{ keys: 'Ctrl+B', unbind: 'workspace.saveFile', context: 'Workspace' }],
        'linux',
      ),
      ['Workspace'],
    ),
  ).toEqual(['workspace.toggleSidebarVisibility'])
  const reserved = resolvedPlatformKeyBindings(
    defaults,
    [{ keys: 'Ctrl+B', command: null, context: 'Workspace' }],
    'linux',
  )
  expect(selected(reserved, ['Workspace'])).toEqual([])
  expect(
    keyBindingResolution(
      defaults,
      [{ keys: 'Ctrl+B', command: null, context: 'Workspace' }],
      'linux',
    ).report,
  ).toContainEqual(expect.objectContaining({ reason: 'unbound', command: 'workspace.saveFile' }))
})

test('unsupported upstream Save keys stay in inventory while valid save bindings remain active', () => {
  for (const preset of ['ours', 'zed'] as const) {
    const result = presetPlatformKeyBindings('linux', preset)
    expect(result.bindings.some((binding) => binding.keys === 'SAVE')).toBe(false)
    expect(result.unmapped).toContainEqual(
      expect.objectContaining({ keys: 'SAVE', command: 'workspace::Save' }),
    )
    expect(result.bindings).toContainEqual(
      expect.objectContaining({ keys: 'Mod+S', command: 'workspace.saveFile' }),
    )
  }
})
