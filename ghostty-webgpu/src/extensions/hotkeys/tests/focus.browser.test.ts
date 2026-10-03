import { afterEach, expect, it } from 'vitest'
import { createBrowserDispatcher, type BrowserDispatcher, type KeymapEntry } from '@fregat/hotkeys'
import { createDomInputController } from '../../../dom/input.js'
import { TerminalSession } from '../../../term/session.js'
import { registerTerminalHotkeys, type TerminalHotkeyRegistration } from '../focus.js'
import type { TerminalClipboard, TerminalCommandTarget } from '../commands.js'
import type { TerminalKeyContextState } from '../context.js'
import { terminalShellKeysPack } from '../packs.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

async function fixture(platform: 'mac' | 'linux' | 'windows' = 'linux') {
  const session = await TerminalSession.create({ appearance: { grid: { columns: 20, rows: 4 } } })
  cleanups.push(() => session.dispose())
  const host = document.createElement('div')
  const textarea = document.createElement('textarea')
  host.append(textarea)
  document.body.append(host)
  cleanups.push(() => host.remove())
  const controller = new AbortController()
  cleanups.push(() => controller.abort())
  const output: string[] = []
  const errors: unknown[] = []
  session.on('data', ({ bytes: data }) => output.push(new TextDecoder().decode(data)))
  const target: TerminalCommandTarget = {
    get appearance() {
      return session.appearance
    },
    getSelection: () => session.getSelection(),
    paste: (data) => session.paste(data),
    sendInput: (data) => session.sendInput(data),
    selectAll: () => session.selectAll().selectionChanged,
    write: (data) => session.write(data),
    setFont: (font) => session.setFont(font),
    key: (input) => session.key(input),
  }
  let registration: TerminalHotkeyRegistration | undefined
  let inputCalls = 0
  const input = createDomInputController({
    session,
    signal: controller.signal,
    textarea,
    platform,
    shortcuts: false,
    onError: (cause) => errors.push(cause),
    hooks: {
      customKeyEvent: (event) => {
        inputCalls += 1
        return registration?.claim(event) !== 'claim'
      },
    },
  })
  cleanups.push(() => input.dispose())
  const copies: string[] = []
  const clipboard: TerminalClipboard = {
    readText: async () => 'clipboard',
    writeText: async (text) => {
      copies.push(text)
    },
  }
  const state: { alternateScreen: boolean; mouseReporting: boolean } = {
    alternateScreen: false,
    mouseReporting: false,
  }
  const shared = {
    element: host,
    terminal: target,
    clipboard,
    signal: controller.signal,
    onError: (cause: unknown) => errors.push(cause),
    readState: (): TerminalKeyContextState => state,
  }
  function standalone(bindings: readonly KeymapEntry[] = []) {
    registration = registerTerminalHotkeys({ ...shared, mode: 'standalone', platform, bindings })
    cleanups.push(() => registration?.dispose())
    return registration
  }
  function hosted(keymap: readonly KeymapEntry[], commands = {}) {
    const observers = new Set<(event: KeyboardEvent) => void>()
    const dispatcher: BrowserDispatcher = createBrowserDispatcher({
      platform,
      keymap,
      beforeKey: (event) => {
        for (const observer of observers) observer(event)
      },
    })
    cleanups.push(() => dispatcher.dispose())
    const parent = dispatcher.createNode({ context: 'Workspace', commands })
    dispatcher.attachElement(parent, host)
    registration = registerTerminalHotkeys({
      ...shared,
      mode: 'hosted',
      dispatcher,
      parent,
      platform,
      observeKeys: (observer) => {
        observers.add(observer)
        return () => {
          observers.delete(observer)
        }
      },
    })
    cleanups.push(() => registration?.dispose())
    return { dispatcher, parent, registration, observers }
  }
  function key(type: 'keydown' | 'keyup', init: KeyboardEventInit) {
    const event = new KeyboardEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      ...init,
    })
    textarea.dispatchEvent(event)
    return event
  }
  textarea.focus()
  return {
    ...shared,
    session,
    key,
    copies,
    controller,
    output,
    errors,
    state,
    textarea,
    standalone,
    hosted,
    inputCalls: () => inputCalls,
  }
}

it('passes an unbound key once and lets a shallower app binding claim Ctrl+B once', async () => {
  const f = await fixture()
  let appCalls = 0
  f.hosted([{ keys: 'Ctrl+B', command: 'sidebar', context: 'Workspace' }], {
    sidebar: () => {
      appCalls += 1
    },
  })
  f.key('keydown', { key: 'a', code: 'KeyA' })
  f.key('keyup', { key: 'a', code: 'KeyA' })
  expect(f.output).toEqual(['a'])
  f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true })
  f.key('keyup', { key: 'b', code: 'KeyB', ctrlKey: true })
  expect(appCalls).toBe(1)
  expect(f.output).toEqual(['a'])
  expect(f.errors).toEqual([])
})

it('a deeper shell pack sends native Kitty press, repeat and release exactly once', async () => {
  const f = await fixture()
  let appCalls = 0
  f.hosted(
    [{ keys: 'Ctrl+B', command: 'sidebar', context: 'Workspace' }, ...terminalShellKeysPack],
    {
      sidebar: () => {
        appCalls += 1
      },
    },
  )
  f.session.write('\u001b[>11u')
  f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true })
  f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, repeat: true })
  f.key('keyup', { key: 'b', code: 'KeyB', ctrlKey: true })
  const received = f.output.slice()
  const input = {
    action: 'press' as const,
    composing: false,
    code: 'KeyB',
    text: 'b',
    modifiers: { control: 'unknown' as const },
  }
  const expected = [
    f.session.key(input),
    f.session.key({ ...input, action: 'repeat' }),
    f.session.key({ ...input, action: 'release' }),
  ].map((bytes) => new TextDecoder().decode(bytes))
  expect(received).toEqual(expected)
  expect(received).toHaveLength(3)
  expect(appCalls).toBe(0)
  expect(f.errors).toEqual([])
})

it('reads live context and removes the node and observer without replacing native input', async () => {
  const f = await fixture()
  let appCalls = 0
  const h = f.hosted(
    [
      { keys: 'Ctrl+B', command: 'sidebar', context: 'Workspace' },
      {
        keys: 'Ctrl+B',
        command: 'terminal.sendKeystroke',
        args: { keystroke: 'ctrl-b' },
        context: 'Terminal && mode == alternate && mouse == on',
      },
    ],
    {
      sidebar: () => {
        appCalls += 1
      },
    },
  )
  f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true })
  f.state.alternateScreen = true
  f.state.mouseReporting = true
  f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true })
  f.key('keyup', { key: 'b', code: 'KeyB', ctrlKey: true })
  expect(appCalls).toBe(1)
  expect(f.output).toEqual(['\u0002'])
  h.registration.dispose()
  expect(h.observers.size).toBe(0)
  expect(h.dispatcher.focused()).toBe(h.parent)
  f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true })
  expect(f.output).toEqual(['\u0002', '\u0002'])
  expect(f.errors).toEqual([])
})

it('composition commits once and native replies bypass the key claim callback', async () => {
  const f = await fixture()
  f.hosted(terminalShellKeysPack)
  f.textarea.dispatchEvent(new CompositionEvent('compositionstart'))
  f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, isComposing: true })
  f.textarea.value = '漢字'
  f.textarea.dispatchEvent(new InputEvent('input', { data: '漢字', inputType: 'insertText' }))
  f.textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '漢字' }))
  f.key('keyup', { key: 'b', code: 'KeyB', ctrlKey: true })
  expect(f.output).toEqual(['漢字'])
  const claims = f.inputCalls()
  f.session.write('\u001b[6n')
  expect(f.output.at(-1)).toBe('\u001b[1;1R')
  expect(f.inputCalls()).toBe(claims)
  expect(f.errors).toEqual([])
})

it.each(['mac', 'linux', 'windows'] as const)(
  'standalone defaults and one override work on %s',
  async (platform) => {
    const f = await fixture(platform)
    f.session.write('copy me')
    const modifier = platform === 'mac' ? { metaKey: true } : { ctrlKey: true, shiftKey: true }
    const registration = f.standalone()
    f.key('keydown', { key: 'a', code: 'KeyA', ...modifier })
    f.key('keyup', { key: 'a', code: 'KeyA', ...modifier })
    f.key('keydown', { key: 'c', code: 'KeyC', ...modifier })
    f.key('keyup', { key: 'c', code: 'KeyC', ...modifier })
    await expect.poll(() => f.copies).toEqual(['copy me'])
    f.key('keydown', { key: 'v', code: 'KeyV', ...modifier })
    await expect.poll(() => f.output).toEqual(['clipboard'])
    const size = f.terminal.appearance.font.size
    const fontModifier = platform === 'mac' ? { metaKey: true } : { ctrlKey: true }
    f.key('keydown', { key: '=', code: 'Equal', ...fontModifier })
    f.key('keydown', { key: '=', code: 'Equal', repeat: true, ...fontModifier })
    await expect.poll(() => f.terminal.appearance.font.size).toBe(size + 2)
    f.key('keydown', { key: '+', code: 'Equal', shiftKey: true, ...fontModifier })
    await expect.poll(() => f.terminal.appearance.font.size).toBe(size + 3)
    f.key('keyup', { key: '=', code: 'Equal', ...fontModifier })
    f.key('keydown', { key: '0', code: 'Digit0', ...fontModifier })
    await expect.poll(() => f.terminal.appearance.font.size).toBe(size)
    f.key('keydown', { key: 'k', code: 'KeyK', ...modifier })
    expect(f.session.readLines(0, 1)[0]?.text.trim()).toBe('')
    registration.dispose()
    f.standalone([
      {
        keys: platform === 'mac' ? 'Meta+C' : 'Ctrl+Shift+C',
        command: 'terminal.sendKeystroke',
        args: { text: 'override' },
        context: 'Terminal',
        source: 'user',
      },
    ])
    f.key('keydown', { key: 'c', code: 'KeyC', ...modifier })
    expect(f.output.at(-1)).toBe('override')
    expect(f.errors).toEqual([])
  },
)

it('disposal cancels clipboard completion and queued font actions while native owner stays live', async () => {
  const f = await fixture()
  let resolveClipboard: (text: string) => void = () => {}
  f.clipboard.readText = () =>
    new Promise<string>((resolve) => {
      resolveClipboard = resolve
    })
  const registration = f.standalone()
  const size = f.terminal.appearance.font.size
  f.key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, shiftKey: true })
  f.key('keydown', { key: '=', code: 'Equal', ctrlKey: true })
  registration.dispose()
  resolveClipboard('late')
  await Promise.resolve()
  await Promise.resolve()
  expect(f.output).toEqual([])
  expect(f.terminal.appearance.font.size).toBe(size)
  f.session.sendInput('alive')
  expect(f.output).toEqual(['alive'])
})

it('disposal releases a held native Kitty key before removing the focus node', async () => {
  const f = await fixture()
  const h = f.hosted(terminalShellKeysPack)
  f.session.write('\u001b[>11u')
  f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true })
  h.registration.dispose()
  const received = f.output.slice()
  const input = {
    action: 'press' as const,
    composing: false,
    code: 'KeyB',
    text: 'b',
    modifiers: { control: 'unknown' as const },
  }
  const expected = [f.session.key(input), f.session.key({ ...input, action: 'release' })].map(
    (bytes) => new TextDecoder().decode(bytes),
  )
  expect(received).toEqual(expected)
  expect(f.errors).toEqual([])
})
