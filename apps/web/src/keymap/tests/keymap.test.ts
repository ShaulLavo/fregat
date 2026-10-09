import { bindingsForInput, compileKeymap, createKeyInput, parseKeyContext } from '@fregat/hotkeys'
import { expect, test } from '../../../test/fixtures'
import { binding } from '../../../test/factories/key-binding'
import { keyBindingResolution, resolvedPlatformKeyBindings } from '@/keymap/active-bindings'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import { editorCommandIdFromPlatform } from '@/keymap/editor-keymap'
import { ours, zed, unmappedPresetBindings } from '@/keymap/presets/inventory'

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
  const unmapped = unmappedPresetBindings('linux', 'ours')
  expect(unmapped.length).toBeGreaterThan(0)
  expect(unmapped[0]).toMatchObject({
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

test('Escape in the text closes the completion list, then the signature hint, then find', () => {
  const escape = (preset: 'ours' | 'zed' | 'vscode', editor: string) =>
    bindingsForInput(
      compileKeymap(
        defaultPlatformKeyBindings('linux', preset).map(({ entry }) => entry),
        'linux',
      ),
      [createKeyInput({ key: 'Escape' })],
      ['Workspace', editor].map(parseKeyContext),
    ).bindings[0]?.command
  for (const preset of ['ours', 'zed', 'vscode'] as const) {
    expect(
      escape(preset, 'Editor writable suggestWidgetVisible parameterHintsVisible findVisible'),
    ).toBe('hideSuggestWidget')
    expect(escape(preset, 'Editor writable parameterHintsVisible findVisible')).toBe(
      'closeParameterHints',
    )
    expect(escape(preset, 'Editor writable findVisible')).toBe('closeFind')
  }
})

test.each([
  ['ours', true],
  ['zed', true],
  ['vscode', undefined],
] as const)('%s item keys fire while typing: %s', (preset, fires) => {
  const items = defaultPlatformKeyBindings('linux', preset).filter(({ command }) =>
    /^workspace\.(selectItem\d|nextItem|previousItem)$/.test(command ?? ''),
  )
  const altTwo = items.find(({ keys }) => keys === 'Alt+2')
  expect(altTwo?.command).toBe('workspace.selectItem2')
  expect(altTwo?.firesWhileTyping).toBe(fires)
})

test('the Zed-based layouts add one Escape row per editor widget', () => {
  for (const preset of ['ours', 'zed'] as const) {
    const added = defaultPlatformKeyBindings('linux', preset)
      .filter(
        ({ keys, context }) =>
          keys === 'Escape' &&
          context?.startsWith('Editor && !EditorWidget') &&
          context.endsWith('Visible'),
      )
      .map(({ command }) => command)
    expect(added.toSorted()).toEqual([
      'editor.closeFind',
      'editor.closeParameterHints',
      'editor.hideSuggestWidget',
    ])
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
    const result = {
      bindings: defaultPlatformKeyBindings('linux', preset),
      unmapped: unmappedPresetBindings('linux', preset),
    }
    expect(result.bindings.some((binding) => binding.keys === 'SAVE')).toBe(false)
    expect(result.unmapped).toContainEqual(
      expect.objectContaining({ keys: 'SAVE', command: 'workspace::Save' }),
    )
    expect(result.bindings).toContainEqual(
      expect.objectContaining({ keys: 'Mod+S', command: 'workspace.saveFile' }),
    )
  }
})

test('VSCode global session Undo and Redo keep native owners even with empty local history', () => {
  const compiled = compileKeymap(
    defaultPlatformKeyBindings('linux', 'vscode').map(({ entry }) => entry),
    'linux',
  )
  for (const shift of [false, true]) {
    const input = createKeyInput({ key: 'Z', modifiers: { ctrl: true, shift } })
    const command = shift ? 'workspace.redoSessionAction' : 'workspace.undoSessionAction'
    for (const contexts of [['Workspace'], ['Workspace', 'Chat'], ['Workspace', 'Sidebar', 'Git']])
      expect(
        bindingsForInput(compiled, [input], contexts.map(parseKeyContext)).bindings.map(
          ({ command }) => command,
        ),
      ).toContain(command)
    for (const owner of ['Editor', 'Terminal', 'FileTree'])
      expect(
        bindingsForInput(compiled, [input], ['Workspace', owner].map(parseKeyContext)).bindings.map(
          ({ command }) => command,
        ),
        owner,
      ).not.toContain(command)
  }
})
