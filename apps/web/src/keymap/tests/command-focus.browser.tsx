import '@workspace/ui/globals.css'
import '@singapore-editor/core/style.css'
import { createEditorFindPlugin } from '@singapore-editor/find'
import { createKeymapEditor } from '../../../test/factories/keymap-editor'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import { commands } from 'vitest/browser'
import { binding } from '../../../test/factories/key-binding'
import { detectPlatform } from '@fregat/hotkeys'
import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { cleanup } from '@testing-library/react'

import { EditorTabActionsProvider } from '@/features/editor/providers/tab-actions-provider'
import { TestEditorStateProvider as EditorStateProvider } from '../../../test/factories/editor-state-provider'
import { MenuSurface } from '@/keymap/menus/components/surface'
import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'
import { actionItem, section } from '@/keymap/menus/utils/model'
import { useCommand } from '@/keymap/hooks/use-command'
import { createUndoBarrierPlugin } from '@/keymap/state/undo-barrier'
import { useKeymapNode } from '@/keymap/hooks/use-keymap-node'
import { CommandProvider } from '@/keymap/providers/command-provider'
import type { CommandDispatchTicket } from '@/keymap/state/command-bus'
import type { PlatformKeyBinding } from '@/keymap/types'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { FocusProvider } from '@/lib/focus/providers/provider'
import { FocusService } from '@/lib/focus/state/service'
import { TestCommandProvider } from '../../../test/factories/command-runtime'
import { paletteContentQueryOptions } from '@/features/command-palette/utils/content-query'
import {
  AppProviders,
  createTestQueryClient,
  holdDeferredDialog,
  loadDeferredDialogs,
  seedHtmlTheme,
  renderHookWithProviders,
} from '../../../test/render'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofContextClick: (input: { readonly selector: string }) => Promise<void>
    proofKeyDown: (input: { readonly key: string }) => Promise<void>
    proofKeyPress: (input: { readonly key: string }) => Promise<void>
    proofKeyUp: (input: { readonly key: string }) => Promise<void>
  }
}

type TrustedKeyRecord = {
  readonly defaultPrevented: boolean
  readonly key: string
  readonly trusted: boolean
}

const trustedKeyBindings: readonly PlatformKeyBinding[] = [
  binding('F2', { command: 'workspace.focusEditor' }),
  binding('F3', { command: 'workspace.toggleWallpaper' }),
  binding('F4', { command: 'workspace.toggleWallpaper' }),
  binding('F4', { command: null, source: 'user' }),
]

let root: Root | null = null
let editorDispatches: string[] = []
let lastEditorTicket: CommandDispatchTicket | null = null
let removeSecondEditor: (() => void) | null = null
let trustedKeyRecords: TrustedKeyRecord[] = []
let nativeEditors: ReturnType<typeof createKeymapEditor>[] = []

afterEach(() => {
  cleanup()
  for (const editor of nativeEditors) editor.dispose()
  nativeEditors = []
  flushSync(() => root?.unmount())
  root = null
  editorDispatches = []
  lastEditorTicket = null
  removeSecondEditor = null
  trustedKeyRecords = []
  document.body.replaceChildren()
  localStorage.clear()
})

test('shared editor and app prefixes dispatch once through real editor input', async () => {
  const calls: boolean[] = []
  const bindings = [
    binding('Mod+K Mod+A', {
      command: 'editor.selectAll',
      context: 'Editor',
      platform: detectPlatform(),
    }),
    binding('Mod+K Mod+S', { command: 'workspace.toggleWallpaper', platform: detectPlatform() }),
  ]
  const view = renderHookWithProviders(
    () => ({ command: useCommand(), focus: useFocusService() }),
    {
      command: {
        bindings,
        runtime: {
          settings: {
            setWallpaperEnabled: (value) => {
              calls.push(value)
              return { kind: 'noop' }
            },
          },
        },
      },
    },
  )
  const target = createKeymapEditor(view.result.current.focus, view.result.current.command.keymap, {
    key: 'shared',
  })
  nativeEditors.push(target)
  target.editor.focus()
  await commands.proofKeyPress({ key: 'ControlOrMeta+k' })
  expect(target.editor.getKeymapContext().hasSelection).toBe(false)
  await commands.proofKeyPress({ key: 'ControlOrMeta+a' })
  expect(target.editor.getKeymapContext().hasSelection).toBe(true)
  await commands.proofKeyPress({ key: 'ControlOrMeta+k' })
  await commands.proofKeyPress({ key: 'ControlOrMeta+s' })
  expect(calls).toEqual([false])
  expect(target.editor.materializeFullText()).toBe('first line\nsecond line\nthird line')
  view.unmount()
})

test('conditional chord alternatives read real selection again on the second stroke', async () => {
  const chord = { platform: detectPlatform() }
  const bindings: readonly PlatformKeyBinding[] = [
    {
      ...binding('Mod+K Mod+X', {
        ...chord,
        command: 'editor.selectAll',
        context: 'Editor && !findVisible',
      }),
    },
    {
      ...binding('Mod+K Mod+X', {
        ...chord,
        command: 'editor.indentSelection',
        context: 'Editor && hasSelection',
      }),
    },
  ]
  const view = renderHookWithProviders(
    () => ({ command: useCommand(), focus: useFocusService() }),
    { command: { bindings } },
  )
  const target = createKeymapEditor(view.result.current.focus, view.result.current.command.keymap, {
    key: 'conditional',
  })
  nativeEditors.push(target)
  target.editor.focus()
  target.editor.setSelection(0, 5)
  await commands.proofKeyPress({ key: 'ControlOrMeta+k' })
  target.editor.setSelection(0)
  await commands.proofKeyPress({ key: 'ControlOrMeta+x' })
  expect(target.editor.getKeymapContext().hasSelection).toBe(true)
  await commands.proofKeyPress({ key: 'ControlOrMeta+k' })
  await commands.proofKeyPress({ key: 'ControlOrMeta+x' })
  expect(target.editor.materializeFullText()).toMatch(
    /^\s+first line\n\s+second line\n\s+third line$/,
  )
  view.unmount()
})

test('moving between real editors in one pane cancels the pending owner', async () => {
  const bindings = [
    binding('Mod+K Mod+A', {
      command: 'editor.selectAll',
      context: 'Editor',
      platform: detectPlatform(),
    }),
  ]
  const view = renderHookWithProviders(
    () => ({ command: useCommand(), focus: useFocusService() }),
    { command: { bindings } },
  )
  const first = createKeymapEditor(view.result.current.focus, view.result.current.command.keymap, {
    key: 'first',
  })
  const second = createKeymapEditor(view.result.current.focus, view.result.current.command.keymap, {
    key: 'second',
  })
  nativeEditors.push(first, second)
  first.editor.focus()
  await commands.proofKeyPress({ key: 'ControlOrMeta+k' })
  expect(view.result.current.command.pendingChord).not.toBeNull()
  second.editor.focus()
  await expect.poll(() => view.result.current.command.pendingChord).toBeNull()
  await commands.proofKeyPress({ key: 'ControlOrMeta+a' })
  expect(first.dispatched).toEqual([])
  expect(second.dispatched).toEqual([])
  view.unmount()
})

test('real editor navigation and deletion work while nested inputs keep their own editing', async () => {
  const view = renderHookWithProviders(() => ({ command: useCommand(), focus: useFocusService() }))
  const target = createKeymapEditor(view.result.current.focus, view.result.current.command.keymap, {
    key: 'editing',
  })
  nativeEditors.push(target)
  target.editor.focus()
  target.editor.setSelection(0)
  await commands.proofKeyPress({ key: 'ArrowDown' })
  expect(target.editor.getState().cursor.row).toBe(1)
  await commands.proofKeyPress({ key: 'Home' })
  expect(target.editor.getState().cursor.column).toBe(0)
  await commands.proofKeyPress({ key: 'Backspace' })
  expect(target.editor.materializeFullText()).toBe('first linesecond line\nthird line')
  await commands.proofKeyPress({ key: 'Shift+End' })
  expect(target.editor.getKeymapContext().hasSelection).toBe(true)
  await commands.proofKeyPress({ key: 'PageUp' })
  expect(target.editor.getState().cursor.row).toBe(0)

  const nested = document.createElement('input')
  nested.value = 'local input'
  target.container.append(nested)
  nested.focus()
  nested.setSelectionRange(nested.value.length, nested.value.length)
  const before = target.editor.materializeFullText()
  const count = target.dispatched.length
  await commands.proofKeyPress({ key: 'Backspace' })
  await commands.proofKeyPress({ key: 'Control+Backspace' })
  expect(nested.value).not.toBe('local input')
  expect(target.editor.materializeFullText()).toBe(before)
  expect(target.dispatched.length).toBe(count)
  view.unmount()
})

test('a real Find field owns select-all, deletion and undo while its close command remains hosted', async () => {
  const view = renderHookWithProviders(() => ({ command: useCommand(), focus: useFocusService() }))
  const target = createKeymapEditor(view.result.current.focus, view.result.current.command.keymap, {
    key: 'find-field',
    plugins: [createEditorFindPlugin()],
  })
  nativeEditors.push(target)
  target.editor.focus()
  const before = target.editor.materializeFullText()
  expect(target.editor.dispatchCommand('find')).toBe(true)
  const input = target.container.querySelector<HTMLInputElement>('input[aria-label="Find"]')
  expect(input).not.toBeNull()
  if (!input) expect.fail('Missing real Find field')
  input.value = 'local query'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.focus()
  await commands.proofKeyPress({ key: 'ControlOrMeta+a' })
  expect(input.selectionStart).toBe(0)
  expect(input.selectionEnd).toBe(input.value.length)
  await commands.proofKeyPress({ key: 'Backspace' })
  expect(input.value).toBe('')
  await commands.proofKeyPress({ key: 'ControlOrMeta+z' })
  expect(target.editor.materializeFullText()).toBe(before)
  await commands.proofKeyPress({ key: 'Escape' })
  expect(target.editor.getKeymapContext().findVisible).toBe(false)
  view.unmount()
})

test('hosted keyboard undo runs the existing barrier contribution before document history', async () => {
  const view = renderHookWithProviders(() => ({ command: useCommand(), focus: useFocusService() }))
  let notifications = 0
  const target = createKeymapEditor(view.result.current.focus, view.result.current.command.keymap, {
    key: 'undo-barrier',
    plugins: [
      createUndoBarrierPlugin(() => {
        notifications++
      }),
    ],
  })
  nativeEditors.push(target)
  target.editor.focus()
  const before = target.editor.materializeFullText()
  await commands.proofKeyPress({ key: 'ControlOrMeta+z' })
  expect(notifications).toBe(1)
  expect(target.editor.materializeFullText()).toBe(before)
  expect(target.editor.dispatchCommand('insertNewlineAndIndent')).toBe(true)
  expect(target.editor.materializeFullText()).not.toBe(before)
  await commands.proofKeyPress({ key: 'ControlOrMeta+z' })
  expect(notifications).toBe(2)
  expect(target.editor.materializeFullText()).toBe(before)
  await commands.proofKeyPress({ key: 'ControlOrMeta+Shift+z' })
  expect(target.editor.materializeFullText()).not.toBe(before)
  target.editor.setPlugins([])
  await commands.proofKeyPress({ key: 'ControlOrMeta+z' })
  expect(target.editor.materializeFullText()).toBe(before)
  expect(notifications).toBe(2)
  view.unmount()
})

test('Tab focus mode lets a native editor release and regain Tab editing', async () => {
  const bindings = [
    ...defaultPlatformKeyBindings(),
    binding('Control+Alt+F8', {
      command: 'editor.action.toggleTabFocusMode',
      context: 'Editor',
      platform: detectPlatform(),
    }),
  ]
  const view = renderHookWithProviders(
    () => ({ command: useCommand(), focus: useFocusService() }),
    { command: { bindings } },
  )
  const target = createKeymapEditor(view.result.current.focus, view.result.current.command.keymap, {
    key: 'tab',
  })
  nativeEditors.push(target)
  const next = document.createElement('input')
  document.body.append(next)
  target.editor.focus()
  await commands.proofKeyPress({ key: 'Control+Alt+F8' })
  expect(target.editor.getKeymapContext().tabFocusMode).toBe(true)
  const before = target.editor.materializeFullText()
  await commands.proofKeyPress({ key: 'Tab' })
  expect(document.activeElement).toBe(next)
  expect(target.editor.materializeFullText()).toBe(before)
  target.editor.focus()
  await commands.proofKeyPress({ key: 'Control+Alt+F8' })
  await commands.proofKeyPress({ key: 'Tab' })
  expect(document.activeElement).toBe(target.editor.getInputElement())
  expect(target.editor.materializeFullText()).not.toBe(before)
  view.unmount()
})

test('read-only diff, search, and settings targets keep navigation and never mutate a writable sibling', async () => {
  const view = renderHookWithProviders(() => ({ command: useCommand(), focus: useFocusService() }))
  const writable = createKeymapEditor(
    view.result.current.focus,
    view.result.current.command.keymap,
    { key: 'writable' },
  )
  nativeEditors.push(writable)
  writable.editor.focus()
  for (const surface of ['diff', 'search-result', 'settings'] as const) {
    const readonly = createKeymapEditor(
      view.result.current.focus,
      view.result.current.command.keymap,
      {
        key: surface,
        surface,
        writable: false,
      },
    )
    nativeEditors.push(readonly)
    readonly.editor.focus()
    readonly.editor.setSelection(0)
    await commands.proofKeyPress({ key: 'ArrowDown' })
    expect(readonly.editor.getState().cursor.row).toBe(1)
    await commands.proofKeyPress({ key: 'Backspace' })
    await commands.proofKeyPress({ key: 'ControlOrMeta+z' })
    expect(readonly.editor.materializeFullText()).toBe('first line\nsecond line\nthird line')
    expect(readonly.dispatched).not.toContain('undo')
    expect(readonly.dispatched).not.toContain('deleteBackward')
  }
  expect(writable.dispatched).toEqual([])
  expect(writable.editor.materializeFullText()).toBe('first line\nsecond line\nthird line')
  view.unmount()
})

test('trusted keys suppress synchronous claims and let null overrides reach native input', async () => {
  const calls: boolean[] = []
  const view = renderHookWithProviders(() => useCommand(), {
    command: {
      bindings: trustedKeyBindings,
      runtime: {
        settings: {
          setWallpaperEnabled: (enabled) => {
            calls.push(enabled)
            return { kind: 'noop' }
          },
        },
      },
    },
  })
  const target = document.createElement('button')
  document.body.append(target)
  const recordKey = (event: KeyboardEvent) =>
    setTimeout(() =>
      trustedKeyRecords.push({
        defaultPrevented: event.defaultPrevented,
        key: event.key,
        trusted: event.isTrusted,
      }),
    )
  window.addEventListener('keydown', recordKey, true)
  target.focus()

  await commands.proofKeyPress({ key: 'F2' })
  await commands.proofKeyPress({ key: 'F3' })
  await commands.proofKeyPress({ key: 'F4' })

  await expect.poll(() => trustedKeyRecords.length).toBe(3)
  expect(trustedKeyRecords).toEqual([
    { defaultPrevented: false, key: 'F2', trusted: true },
    { defaultPrevented: true, key: 'F3', trusted: true },
    { defaultPrevented: false, key: 'F4', trusted: true },
  ])
  expect(calls).toEqual([false])
  window.removeEventListener('keydown', recordKey, true)
  view.unmount()
})

test('trusted chord completion, replayed unmatched text and bound-prefix expiry preserve input focus', async () => {
  const calls: boolean[] = []
  const bindings = [
    binding('Mod+K', { command: 'workspace.toggleWallpaper', platform: detectPlatform() }),
    binding('Mod+K Mod+S', { command: 'workspace.toggleWallpaper', platform: detectPlatform() }),
    binding('Mod+S', { command: 'workspace.toggleWallpaper', platform: detectPlatform() }),
  ]
  const view = renderHookWithProviders(() => useCommand(), {
    command: {
      bindings,
      runtime: {
        settings: {
          setWallpaperEnabled: (enabled) => {
            calls.push(enabled)
            return { kind: 'noop' }
          },
        },
      },
    },
  })
  const input = document.createElement('input')
  input.value = 'keep'
  document.body.append(input)
  input.focus()
  input.setSelectionRange(4, 4)
  const modifier = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  const reachedInput: string[] = []
  input.addEventListener('keydown', (event) => {
    if (event.key === 'x') reachedInput.push(event.key)
  })

  try {
    await commands.proofKeyPress({ key: 'ControlOrMeta+k' })
    await expect.poll(() => view.result.current.pendingChord).not.toBeNull()
    await commands.proofKeyDown({ key: 'x' })
    await commands.proofKeyDown({ key: 'x' })
    await commands.proofKeyUp({ key: 'x' })
    expect(input.value).toBe('keepxx')
    expect(reachedInput).toEqual(['x', 'x'])
    expect(view.result.current.pendingChord).toBeNull()
    expect(calls).toEqual([false])

    await commands.proofKeyPress({ key: 'ControlOrMeta+k' })
    await commands.proofKeyDown({ key: modifier })
    await commands.proofKeyDown({ key: 's' })
    await commands.proofKeyDown({ key: 's' })
    await commands.proofKeyUp({ key: 's' })
    await commands.proofKeyUp({ key: modifier })
    expect(input.value).toBe('keepxx')
    expect(calls).toEqual([false, false])

    await commands.proofKeyPress({ key: 'ControlOrMeta+k' })
    await expect.poll(() => view.result.current.pendingChord, { timeout: 6_000 }).toBeNull()
    await commands.proofKeyPress({ key: 'x' })
    expect(input.value).toBe('keepxxx')
    expect(reachedInput).toEqual(['x', 'x', 'x'])
    expect(calls).toEqual([false, false, false])
  } finally {
    await commands.proofKeyUp({ key: 'x' })
    await commands.proofKeyUp({ key: 's' })
    await commands.proofKeyUp({ key: modifier })
    view.unmount()
    input.remove()
  }
})

test('deepest event target wins and read-only focus cannot fall through', async () => {
  const focus = new FocusService()
  const queryClient = createTestQueryClient()
  mount(
    <FocusProvider service={focus}>
      <TestCommandProvider
        queryClient={queryClient}
        options={{
          bindings: [
            binding('Mod+K Mod+A', {
              command: 'editor.selectAll',
              context: 'Editor',
              platform: detectPlatform(),
            }),
            binding('Mod+K Mod+Z', {
              command: 'editor.undo',
              context: 'Editor',
              platform: detectPlatform(),
            }),
          ],
        }}
      >
        <EditorRoutingHarness />
      </TestCommandProvider>
    </FocusProvider>,
  )
  const child = await element('[data-editor-child]')
  child.focus()
  await expect
    .poll(() => focus.getSnapshot().currentOwner?.id)
    .toEqual({
      key: 'child',
      kind: 'editor',
      surface: 'document',
    })

  await commands.proofKeyPress({ key: 'F6' })

  await expect.poll(() => editorDispatches).toEqual(['child:selectAll'])
  expect(lastEditorTicket?.claimed).toBe(true)
  await expect(lastEditorTicket?.completion).resolves.toEqual({ status: 'handled' })

  flushSync(() => removeSecondEditor?.())
  expect(focus.getSnapshot().currentOwner?.id).toEqual({
    key: 'child',
    kind: 'editor',
    surface: 'document',
  })

  const readOnly = await element('[data-editor-readonly]')
  readOnly.focus()
  await commands.proofKeyPress({ key: 'F7' })

  await expect.poll(() => lastEditorTicket?.claimed).toBe(false)
  expect(editorDispatches).toEqual(['child:selectAll'])
  await expect(lastEditorTicket?.completion).resolves.toMatchObject({ status: 'disabled' })

  await commands.proofKeyPress({ key: 'ControlOrMeta+k' })
  await commands.proofKeyPress({ key: 'ControlOrMeta+z' })
  expect(editorDispatches).toEqual(['child:selectAll'])
  child.focus()
  await commands.proofKeyPress({ key: 'ControlOrMeta+k' })
  await commands.proofKeyPress({ key: 'ControlOrMeta+a' })
  expect(editorDispatches).toEqual(['child:selectAll', 'child:selectAll'])
})

test('palette and settings restore only after their modal targets depart', async () => {
  await loadDeferredDialogs()
  const focus = mountOverlayOrigins()

  const paletteOrigin = await element('[data-open-palette]')
  paletteOrigin.focus()
  paletteOrigin.click()
  const paletteInput = await element<HTMLInputElement>('input[placeholder="Search commands…"]')
  await expect.poll(() => document.activeElement).toBe(paletteInput)
  expect(focus.getSnapshot().currentOwner?.area).toBe('command-palette')

  await commands.proofKeyPress({ key: 'Escape' })

  await expect
    .poll(() => document.querySelector('input[placeholder="Search commands…"]'))
    .toBeNull()
  await expect.poll(() => document.activeElement).toBe(paletteOrigin)
  expect(focus.getSnapshot().currentOwner?.id).toEqual({
    key: 'palette-origin',
    kind: 'editor',
    surface: 'document',
  })

  const settingsOrigin = await element('[data-open-settings]')
  settingsOrigin.focus()
  settingsOrigin.click()
  const settingsDialog = await element<HTMLElement>('[role="dialog"]')
  await expect.poll(() => settingsDialog.contains(document.activeElement)).toBe(true)
  expect(focus.getSnapshot().currentOwner?.id).toEqual({ kind: 'settings-dialog' })

  await commands.proofKeyPress({ key: 'Escape' })

  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
  await expect.poll(() => document.activeElement).toBe(settingsOrigin)
  expect(focus.getSnapshot().currentOwner?.id).toEqual({
    key: 'settings-origin',
    kind: 'editor',
    surface: 'document',
  })
})

test('a palette opened before its module loads keeps focus and restores its origin', async () => {
  await loadDeferredDialogs()
  const release = holdDeferredDialog(paletteContentQueryOptions.queryKey, loadPaletteContent)
  const focus = mountOverlayOrigins()
  const origin = await element('[data-open-palette]')
  const originId = { key: 'palette-origin', kind: 'editor', surface: 'document' }

  origin.focus()
  origin.click()
  const shellInput = await element<HTMLInputElement>('input[placeholder="Search…"]')
  await expect.poll(() => document.activeElement).toBe(shellInput)
  await commands.proofKeyPress({ key: 'Escape' })

  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
  await expect.poll(() => document.activeElement).toBe(origin)
  expect(focus.getSnapshot().currentOwner?.id).toEqual(originId)

  origin.click()
  const heldInput = await element<HTMLInputElement>('input[placeholder="Search…"]')
  await expect.poll(() => document.activeElement).toBe(heldInput)
  await commands.proofKeyPress({ key: 'a' })
  await expect.poll(() => heldInput.value).toMatch(/a$/)
  const typed = heldInput.value
  release()

  const paletteInput = await element<HTMLInputElement>('input[placeholder="Search commands…"]')
  await expect.poll(() => document.activeElement).toBe(paletteInput)
  expect(paletteInput.value).toBe(typed)
  expect(focus.getSnapshot().currentOwner?.area).toBe('command-palette')
  await commands.proofKeyPress({ key: 'Escape' })

  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
  await expect.poll(() => document.activeElement).toBe(origin)
  expect(focus.getSnapshot().currentOwner?.id).toEqual(originId)
})

test('a virtual menu restores the context target rather than prior DOM focus', async () => {
  const focus = new FocusService()
  const queryClient = createTestQueryClient()
  mount(
    <FocusProvider service={focus}>
      <TestCommandProvider queryClient={queryClient}>
        <VirtualMenuHarness />
      </TestCommandProvider>
    </FocusProvider>,
  )
  const editor = await element('[data-menu-editor-origin]')
  const terminal = await element('[data-menu-terminal]')
  editor.focus()

  await commands.proofContextClick({ selector: '[data-menu-terminal]' })

  await element('[data-menu-surface="terminal"]')
  expect(document.activeElement).not.toBe(editor)
  await commands.proofKeyPress({ key: 'Escape' })

  await expect.poll(() => document.querySelector('[data-menu-surface="terminal"]')).toBeNull()
  await expect.poll(() => document.activeElement).toBe(terminal)
  expect(focus.getSnapshot().currentOwner?.id).toEqual({
    kind: 'terminal',
    rootPath: '/repo',
    sessionId: 'browser',
  })
})

function EditorRoutingHarness() {
  const { bus } = useCommand()
  const [secondMounted, setSecondMounted] = useState(true)
  const { ref: parentRef } = useEditorTarget('parent', true)
  const { ref: childRef } = useEditorTarget('child', true)
  const { ref: readOnlyRef } = useEditorTarget('readonly', false)
  const { ref: secondRef } = useEditorTarget('second', true)
  useEffect(() => {
    removeSecondEditor = () => setSecondMounted(false)
    return () => {
      removeSecondEditor = null
    }
  }, [])

  function dispatchFromEvent(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'F6' && event.key !== 'F7') return

    const command = event.key === 'F7' ? 'editor.undo' : 'editor.selectAll'
    lastEditorTicket = bus.dispatch(command, {
      event: event.nativeEvent,
      source: { caller: 'command-focus-browser', kind: 'programmatic' },
    })
  }

  return (
    <div data-workbench>
      <section ref={parentRef}>
        <button data-editor-child onKeyDown={dispatchFromEvent} ref={childRef}>
          Writable child
        </button>
        <button data-editor-readonly onKeyDown={dispatchFromEvent} ref={readOnlyRef}>
          Read-only child
        </button>
      </section>
      {secondMounted ? <button ref={secondRef}>Second editor</button> : null}
    </div>
  )
}

function useEditorTarget(key: string, writable: boolean) {
  const keymapRef = useKeymapNode({
    area: 'editor',
    context: 'Editor',
    commands: {
      selectAll: () => {
        editorDispatches.push(`${key}:selectAll`)
        return true
      },
      undo: () => {
        if (!writable) return false
        editorDispatches.push(`${key}:undo`)
        return true
      },
    },
  })
  const focus = useFocusTarget<HTMLElement>({
    area: 'editor',
    capabilities: {
      editor: {
        dispatch: (command) => {
          editorDispatches.push(`${key}:${command}`)
          return true
        },
        writable,
      },
    },
    id: { key, kind: 'editor', surface: 'document' },
    onIntent: (intent, element) => {
      if (intent !== 'focus') return false

      element.focus()
      return true
    },
  })
  return {
    ...focus,
    ref: (element: HTMLElement | null) => {
      focus.ref(element)
      keymapRef(element)
    },
  }
}

function mountOverlayOrigins() {
  const focus = new FocusService()
  seedHtmlTheme('dark')
  mount(
    <AppProviders command={false} focusService={focus} queryClient={createTestQueryClient()}>
      <EditorStateProvider>
        <EditorTabActionsProvider
          requestCloseTab={rejectCloseTab}
          requestCloseTabs={rejectCloseTabs}
        >
          <CommandProvider>
            <OverlayOrigins />
          </CommandProvider>
        </EditorTabActionsProvider>
      </EditorStateProvider>
    </AppProviders>,
  )
  return focus
}

function loadPaletteContent() {
  return import('@/features/command-palette/components/content')
}

function OverlayOrigins() {
  const { bus } = useCommand()
  const { ref: paletteOriginRef } = useOriginTarget('palette-origin')
  const { ref: settingsOriginRef } = useOriginTarget('settings-origin')

  return (
    <div data-workbench>
      <button
        data-open-palette
        onClick={() => bus.dispatch('workspace.showCommandPalette', invocation())}
        ref={paletteOriginRef}
      >
        Open palette
      </button>
      <button
        data-open-settings
        onClick={() => bus.dispatch('workspace.showSettings', invocation())}
        ref={settingsOriginRef}
      >
        Open settings
      </button>
    </div>
  )
}

function VirtualMenuHarness() {
  const contextMenu = useContextMenu()
  const { ref: editorRef } = useOriginTarget('menu-editor')
  const { ref: terminalRef } = useFocusTarget<HTMLElement>({
    area: 'terminal',
    id: { kind: 'terminal', rootPath: '/repo', sessionId: 'browser' },
    onIntent: (intent, element) => {
      if (intent !== 'focus') return false

      element.focus()
      return true
    },
  })

  return (
    <div data-workbench>
      <button data-menu-editor-origin ref={editorRef}>
        Editor origin
      </button>
      <section
        data-menu-terminal
        onContextMenu={(event) => contextMenu.openAtEvent(event, event.currentTarget)}
        ref={terminalRef}
        tabIndex={-1}
      >
        Terminal
      </section>
      {contextMenu.anchor ? (
        <MenuSurface
          anchor={contextMenu.anchor}
          menu={[section('browser', [actionItem({ id: 'copy', label: 'Copy', run: () => {} })])]}
          onOpenChange={contextMenu.onOpenChange}
          open
          surface='terminal'
        />
      ) : null}
    </div>
  )
}

function useOriginTarget(key: string) {
  return useFocusTarget<HTMLButtonElement>({
    area: 'editor',
    capabilities: { editor: { dispatch: () => false, writable: true } },
    id: { key, kind: 'editor', surface: 'document' },
    onIntent: (intent, element) => {
      if (intent !== 'focus') return false

      element.focus()
      return true
    },
  })
}

function invocation() {
  return { source: { caller: 'command-focus-browser', kind: 'programmatic' } } as const
}

function mount(children: ReactNode) {
  const host = document.createElement('main')
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => root?.render(children))
}

async function element<E extends HTMLElement = HTMLElement>(selector: string) {
  await expect.poll(() => document.querySelector(selector)).toBeTruthy()
  return document.querySelector<E>(selector)!
}

function rejectCloseTab() {
  return { reason: 'not-found', status: 'rejected' } as const
}

function rejectCloseTabs() {
  return { reason: 'not-found', status: 'rejected' } as const
}

test.each(['input', 'textarea', 'contenteditable', 'editor'])(
  'F1 opens the palette from %s while letters still type',
  async (kind) => {
    const view = renderHookWithProviders(
      () => ({ command: useCommand(), focus: useFocusService() }),
      {
        command: {
          bindings: [
            ...defaultPlatformKeyBindings(),
            ...(kind === 'editor'
              ? []
              : [binding('x', { command: 'workspace.showCommandPalette' })]),
          ],
        },
      },
    )
    const target = document.createElement(kind === 'textarea' ? 'textarea' : 'input')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    document.body.append(target, editable)
    const editor =
      kind === 'editor'
        ? createKeymapEditor(view.result.current.focus, view.result.current.command.keymap, {
            key: 'fkeys',
          })
        : null
    if (editor) nativeEditors.push(editor)
    if (editor) editor.editor.focus()
    else if (kind === 'contenteditable') editable.focus()
    else target.focus()
    try {
      await commands.proofKeyPress({ key: 'x' })
      expect(view.result.current.command.paletteOpen).toBe(false)
      if (editor) expect(editor.editor.materializeFullText()).toContain('x')
      else if (kind === 'contenteditable') expect(editable.textContent).toBe('x')
      else expect(target.value).toBe('x')
      await commands.proofKeyPress({ key: 'F1' })
      await expect.poll(() => view.result.current.command.paletteOpen).toBe(true)
    } finally {
      view.unmount()
      target.remove()
      editable.remove()
    }
  },
)
