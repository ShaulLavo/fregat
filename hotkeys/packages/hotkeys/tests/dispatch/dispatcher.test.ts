import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDispatcher, createKeyInput } from '../../src'
import type { KeyInput, KeymapEntry } from '../../src'

afterEach(() => {
  vi.useRealTimers()
})

function press(spec: string): KeyInput {
  const parts = spec.split('-')
  const key = parts.pop()!
  return createKeyInput({
    key,
    code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : '',
    modifiers: { ctrl: parts.includes('ctrl'), shift: parts.includes('shift') },
  })
}

describe('focus nodes and resolution', () => {
  function workbench(keymap: readonly KeymapEntry[]) {
    const calls: string[] = []
    const dispatcher = createDispatcher({ platform: 'linux', keymap })
    const workspace = dispatcher.createNode({
      context: 'Workspace',
      commands: { 'sidebar.toggle': () => void calls.push('sidebar') },
    })
    const pane = dispatcher.createNode({ parent: workspace, context: 'Pane' })
    const editor = dispatcher.createNode({ parent: pane, context: 'Editor extension=md' })
    return { dispatcher, workspace, pane, editor, calls }
  }
  const keymap: KeymapEntry[] = [
    { keys: 'Control+B', command: 'sidebar.toggle', context: 'Workspace', source: 'default' },
    {
      keys: 'Control+B',
      command: 'markdown.bold',
      context: 'Editor && extension == md',
      source: 'pack',
    },
  ]

  it('builds the context stack from the focus path', () => {
    const { dispatcher, editor } = workbench(keymap)
    editor.focus()
    expect(dispatcher.contextStack().map((context) => [...context.identifiers])).toEqual([
      ['Workspace'],
      ['Pane'],
      ['Editor'],
    ])
  })

  it('runs the binding of the deepest matching context', () => {
    const { dispatcher, editor, calls } = workbench(keymap)
    editor.handle('markdown.bold', () => void calls.push('bold'))
    editor.focus()
    expect(dispatcher.handleKey(press('ctrl-b'), null)).toBe(true)
    expect(calls).toEqual(['bold'])
  })

  it('passes a declined command to the next candidate', () => {
    const { dispatcher, editor, calls } = workbench(keymap)
    editor.handle('markdown.bold', () => false)
    editor.focus()
    expect(dispatcher.handleKey(press('ctrl-b'), null)).toBe(true)
    expect(calls).toEqual(['sidebar'])
  })

  it('bubbles a command from the focused node to the ancestor that handles it', () => {
    const { dispatcher, pane, calls } = workbench(keymap)
    pane.focus()
    dispatcher.handleKey(press('ctrl-b'), null)
    expect(calls).toEqual(['sidebar'])
  })

  it('leaves a key no handler takes to default input handling', () => {
    const dispatcher = createDispatcher({
      platform: 'linux',
      keymap: [{ keys: 'Control+S', command: 'file.save' }],
    })
    dispatcher.createNode({ context: 'Editor' }).focus()
    expect(dispatcher.handleKey(press('ctrl-s'), null)).toBe(false)
    expect(dispatcher.handleKey(press('q'), null)).toBe(false)
  })

  it('a user unbind returns the key to the shallower layer', () => {
    const { dispatcher, editor, calls } = workbench([
      ...keymap,
      { keys: 'Control+B', unbind: 'markdown.bold', context: 'Editor', source: 'user' },
    ])
    editor.handle('markdown.bold', () => void calls.push('bold'))
    editor.focus()
    dispatcher.handleKey(press('ctrl-b'), null)
    expect(calls).toEqual(['sidebar'])
  })

  it('dispatches a command without a key along the focus path', () => {
    const { dispatcher, editor, calls } = workbench(keymap)
    editor.focus()
    expect(dispatcher.dispatchCommand('sidebar.toggle')).toBe(true)
    expect(dispatcher.dispatchCommand('missing')).toBe(false)
    expect(calls).toEqual(['sidebar'])
  })

  it('passes binding args to the handler', () => {
    const dispatcher = createDispatcher({
      platform: 'linux',
      keymap: [{ keys: 'Control+1', command: 'tab.select', args: { index: 0 } }],
    })
    const seen: unknown[] = []
    dispatcher
      .createNode({ commands: { 'tab.select': ({ args }) => void seen.push(args) } })
      .focus()
    dispatcher.handleKey(
      createKeyInput({ key: '1', code: 'Digit1', modifiers: { ctrl: true } }),
      null,
    )
    expect(seen).toEqual([{ index: 0 }])
  })

  it('moves focus to the parent when the focused node is removed', () => {
    const { dispatcher, pane, editor } = workbench(keymap)
    editor.focus()
    editor.remove()
    expect(dispatcher.focused()).toBe(pane)
  })

  it('ends a pending chord when focus moves to another node', () => {
    const calls: string[] = []
    const dispatcher = createDispatcher({
      platform: 'linux',
      keymap: [{ keys: 'Control+K Control+C', command: 'comment' }],
    })
    const first = dispatcher.createNode({ commands: { comment: () => void calls.push('first') } })
    const second = dispatcher.createNode({ commands: { comment: () => void calls.push('second') } })
    first.focus()
    expect(dispatcher.handleKey(press('ctrl-k'), null)).toBe(true)
    second.focus()
    dispatcher.handleKey(press('ctrl-c'), null)
    expect(calls).toEqual([])
    expect(dispatcher.pending()).toBeNull()
  })

  it('drops a timed-out prefix when focus moved while it waited', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const dispatcher = createDispatcher({
      platform: 'linux',
      keymap: [
        { keys: 'Control+K', command: 'k' },
        { keys: 'Control+K Control+C', command: 'kc' },
      ],
    })
    const root = dispatcher.createNode()
    const editor = dispatcher.createNode({
      parent: root,
      commands: { k: () => void calls.push('editor') },
    })
    const terminal = dispatcher.createNode({
      parent: root,
      commands: { k: () => void calls.push('terminal') },
    })
    editor.focus()
    expect(dispatcher.handleKey(press('ctrl-k'), null)).toBe(true)
    terminal.focus()
    vi.advanceTimersByTime(1000)
    expect(calls).toEqual([])
    expect(dispatcher.pending()).toBeNull()
  })
})

// Pending cases from Zed's crates/gpui/src/key_dispatch.rs tests (zed-industries/zed@933d8d9).
describe('Zed pending input', () => {
  function terminal(keymap: readonly KeymapEntry[], acceptsText = false) {
    const counts = { action: 0, secondary: 0 }
    const typed: string[] = []
    const dispatcher = createDispatcher<null>({
      platform: 'linux',
      keymap,
      replay: (input) => typed.push(input.key),
      acceptsTextInput: () => acceptsText,
    })
    dispatcher
      .createNode({
        context: 'Terminal',
        commands: {
          action: () => void counts.action++,
          secondary: () => void counts.secondary++,
        },
      })
      .focus()
    return { dispatcher, counts, typed }
  }
  const timeoutKeymap: KeymapEntry[] = [
    { keys: 'Control+B', command: 'action', context: 'Terminal' },
    { keys: 'Control+B H', command: 'secondary', context: 'Terminal' },
    { keys: 'Control+B H J', command: 'action', context: 'Terminal' },
  ]

  it('test_pending_has_binding_state: an unbound prefix pends without a timeout', () => {
    vi.useFakeTimers()
    const { dispatcher, counts } = terminal([
      { keys: 'Control+B H', command: 'action' },
      { keys: 'Space', command: 'action', context: 'ContextA' },
      { keys: 'Space F G', command: 'action', context: 'ContextB' },
    ])
    dispatcher.handleKey(press('ctrl-b'), null)
    vi.advanceTimersByTime(10_000)
    expect(dispatcher.pending()?.keys).toBe('Mod+B')
    dispatcher.handleKey(press('h'), null)
    expect(counts.action).toBe(1)
    const node = dispatcher.createNode({ context: 'ContextB' })
    node.focus()
    dispatcher.handleKey(createKeyInput({ key: ' ', code: 'Space' }), null)
    vi.advanceTimersByTime(10_000)
    expect(dispatcher.pending()?.keys).toBe('Space')
  })

  it('test_pending_input_timeout_dispatches_shorter_binding', () => {
    vi.useFakeTimers()
    const { dispatcher, counts } = terminal(timeoutKeymap)
    dispatcher.handleKey(press('ctrl-b'), null)
    expect(counts).toEqual({ action: 0, secondary: 0 })
    vi.advanceTimersByTime(1000)
    expect(dispatcher.pending()).toBeNull()
    expect(counts).toEqual({ action: 1, secondary: 0 })
  })

  it('test_running_pending_input_timeout_resets_when_binding_advances', () => {
    vi.useFakeTimers()
    const { dispatcher, counts } = terminal(timeoutKeymap)
    dispatcher.handleKey(press('ctrl-b'), null)
    vi.advanceTimersByTime(800)
    dispatcher.handleKey(press('h'), null)
    vi.advanceTimersByTime(200)
    expect(dispatcher.pending()).not.toBeNull()
    expect(counts).toEqual({ action: 0, secondary: 0 })
    vi.advanceTimersByTime(800)
    expect(dispatcher.pending()).toBeNull()
    expect(counts).toEqual({ action: 0, secondary: 1 })
  })

  it('test_pending_input_timeout_starts_when_binding_becomes_ambiguous', () => {
    vi.useFakeTimers()
    const { dispatcher, counts } = terminal([
      { keys: 'Control+B H', command: 'secondary', context: 'Terminal' },
      { keys: 'Control+B H J', command: 'action', context: 'Terminal' },
    ])
    dispatcher.handleKey(press('ctrl-b'), null)
    vi.advanceTimersByTime(5000)
    expect(dispatcher.pending()).not.toBeNull()
    dispatcher.handleKey(press('h'), null)
    vi.advanceTimersByTime(1000)
    expect(dispatcher.pending()).toBeNull()
    expect(counts).toEqual({ action: 0, secondary: 1 })
  })

  it('test_invalid_continuation_while_timeout_paused_replays_pending_input', () => {
    vi.useFakeTimers()
    const { dispatcher, counts } = terminal([
      { keys: 'Control+B', command: 'action', context: 'Terminal' },
      { keys: 'Control+B H', command: 'secondary', context: 'Terminal' },
      { keys: 'X', command: 'secondary', context: 'Terminal' },
    ])
    dispatcher.handleKey(press('ctrl-b'), null)
    dispatcher.handleKey(press('x'), null)
    expect(dispatcher.pending()).toBeNull()
    expect(counts).toEqual({ action: 1, secondary: 1 })
    vi.advanceTimersByTime(1000)
    expect(counts).toEqual({ action: 1, secondary: 1 })
  })

  it('test_printable_pending_input_replays_on_timeout', () => {
    vi.useFakeTimers()
    const { dispatcher, counts, typed } = terminal(
      [{ keys: 'J K', command: 'action', context: 'Terminal' }],
      true,
    )
    expect(dispatcher.handleKey(press('j'), null)).toBe(true)
    expect(typed).toEqual([])
    vi.advanceTimersByTime(1000)
    expect(dispatcher.pending()).toBeNull()
    expect(counts.action).toBe(0)
    expect(typed).toEqual(['J'])
  })

  it('dispatch_key: a mismatch matches the leftover keys and the new key again', () => {
    const calls: string[] = []
    const dispatcher = createDispatcher({
      platform: 'linux',
      keymap: [
        { keys: 'A B C', command: 'abc' },
        { keys: 'B D', command: 'bd' },
      ],
    })
    dispatcher
      .createNode({
        commands: { abc: () => void calls.push('abc'), bd: () => void calls.push('bd') },
      })
      .focus()
    for (const key of ['a', 'b', 'd']) dispatcher.handleKey(press(key), null)
    expect(calls).toEqual(['bd'])
    expect(dispatcher.pending()).toBeNull()
  })

  it('dispatch_key: leftover keys and the new key may start a chord again', () => {
    const { dispatcher, counts, typed } = terminal([
      { keys: 'A B C', command: 'action' },
      { keys: 'B D E', command: 'secondary' },
    ])
    for (const key of ['a', 'b', 'd']) dispatcher.handleKey(press(key), null)
    expect(dispatcher.pending()?.keys).toBe('B D')
    expect(typed).toEqual(['A'])
    dispatcher.handleKey(press('e'), null)
    expect(counts).toEqual({ action: 0, secondary: 1 })
  })

  it('a printable prefix outside text input waits for the next key', () => {
    vi.useFakeTimers()
    const { dispatcher, counts } = terminal([
      { keys: 'J K', command: 'action', context: 'Terminal' },
    ])
    dispatcher.handleKey(press('j'), null)
    vi.advanceTimersByTime(10_000)
    dispatcher.handleKey(press('k'), null)
    expect(counts.action).toBe(1)
  })
})
