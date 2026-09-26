import { commandPaletteItems } from '@/features/command-palette/utils/query'
import { platformCommandSpecs } from '@/keymap/command-registry'
import { platformCommands } from '@/keymap/table'
import { isCommandVisibleInPalette } from '@/keymap/utils/palette-visibility'
import { FocusService } from '@/lib/focus/state/service'
import { createTestCommandRuntime } from '../../../test/factories/command-runtime'
import { expect, test } from '../../../test/fixtures'
import { createTestQueryClient } from '../../../test/render'

test('offers useful editing actions once while keyboard-only commands still dispatch', async () => {
  const focus = new FocusService()
  const dispatched: string[] = []
  const registration = focus.register({
    area: 'editor',
    capabilities: {
      editor: {
        dispatch: (id) => {
          dispatched.push(id)
          return true
        },
        writable: true,
      },
    },
    element: document.createElement('textarea'),
    id: { key: '/repo/file.ts', kind: 'editor', surface: 'document', tabId: 'palette-tab' },
    onIntent: () => true,
  })
  const { bus, bindings } = createTestCommandRuntime({
    focus,
    options: { rootPath: '/repo' },
    queryClient: createTestQueryClient(),
  })
  const invocation = { origin: registration.token, source: { kind: 'palette' } } as const
  const origin = focus.getTarget(registration.token)
  const items = commandPaletteItems(platformCommandSpecs, bindings).filter((item) =>
    isCommandVisibleInPalette(
      item.command.command,
      bus.capture(invocation).inspect(item.command.command),
      origin,
    ),
  )
  const titles = items.map((item) => item.title)

  expect(titles).toEqual(
    expect.arrayContaining([
      'Format document',
      'Rename symbol',
      'Fold',
      'Sort lines ascending',
      'Toggle line comment',
    ]),
  )
  expect(titles.filter((title) => title === 'Go to definition')).toHaveLength(1)
  expect(titles).not.toContain('Move cursor left')
  expect(titles).not.toContain('Delete backward')
  expect(titles).not.toContain('Close find')
  expect(titles).not.toContain('Accept inline suggestion')
  expect(platformCommandSpecs.some((spec) => spec.id === 'editor.cursorLeft')).toBe(true)

  const ticket = bus.dispatch('editor.cursorLeft', {
    ...invocation,
    source: { kind: 'keybinding' },
  })
  await expect(ticket.completion).resolves.toEqual({ status: 'handled' })
  expect(dispatched).toEqual(['cursorLeft'])
  registration.unregister()
})

test('hides unrelated editor actions but keeps read-only editing actions visibly disabled', () => {
  const focus = new FocusService()
  const { bus } = createTestCommandRuntime({ focus, queryClient: createTestQueryClient() })
  const invocation = { source: { kind: 'palette' } } as const
  const editorCommand = 'editor.editor.action.formatDocument'
  expect(
    isCommandVisibleInPalette(editorCommand, bus.capture(invocation).inspect(editorCommand), null),
  ).toBe(false)

  const registration = focus.register({
    area: 'editor',
    capabilities: { editor: { dispatch: () => true, writable: false } },
    element: document.createElement('textarea'),
    id: { key: '/repo/file.ts', kind: 'editor', surface: 'document', tabId: 'read-only-tab' },
    onIntent: () => true,
  })
  const editorInvocation = { ...invocation, origin: registration.token }
  const inspection = bus.capture(editorInvocation).inspect(editorCommand)
  expect(inspection.status).toBe('disabled')
  expect(
    isCommandVisibleInPalette(editorCommand, inspection, focus.getTarget(registration.token)),
  ).toBe(true)

  const chat = focus.register({
    area: 'chat',
    element: document.createElement('textarea'),
    id: { key: '/repo', kind: 'chat-composer' },
    onIntent: () => true,
  })
  expect(isCommandVisibleInPalette(editorCommand, inspection, focus.getTarget(chat.token))).toBe(
    false,
  )
  registration.unregister()
  chat.unregister()
})

test('keeps global preferences and relevant disabled commands while hiding other layouts', () => {
  const focus = new FocusService()
  const { bus, runtime } = createTestCommandRuntime({
    focus,
    options: { rootPath: '/repo' },
    queryClient: createTestQueryClient(),
  })
  const rootFolder = runtime.workspace.getState().rootFolder
  runtime.workspace.getState().switchWorkspace(null)
  const invocation = { source: { kind: 'palette' } } as const
  const visible = () =>
    platformCommands
      .filter((command) =>
        isCommandVisibleInPalette(command.id, bus.capture(invocation).inspect(command.id), null),
      )
      .map((command) => command.id)

  expect(visible()).toEqual(
    expect.arrayContaining(['workspace.showSettings', 'workspace.selectColorTheme']),
  )
  expect(visible()).not.toContain('workspace.openSearchEditor')
  expect(visible()).not.toContain('workspace.newSession')
  expect(visible()).toContain('workspace.saveFile')
  expect(bus.capture(invocation).inspect('workspace.saveFile').status).toBe('disabled')

  runtime.workspace.getState().switchWorkspace(rootFolder)
  runtime.workspace.getState().setUiMode('workbench')
  expect(visible()).toContain('workspace.openSearchEditor')
  expect(visible()).not.toContain('workspace.newSession')
  runtime.workspace.getState().setUiMode('chat')
  expect(visible()).toContain('workspace.newSession')
})
