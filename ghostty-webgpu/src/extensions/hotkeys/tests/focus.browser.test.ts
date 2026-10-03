import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createBrowserDispatcher, type KeymapEntry, type KeymapPlatform } from '@fregat/hotkeys'
import {
  Terminal as MainTerminal,
  hotkeys,
  terminalDefaultPack,
  terminalShellKeysPack,
} from '../../../../dist/index.js'
import { page } from 'vitest/browser'
import type { TerminalApi } from '../../../../dist/dom/terminal-api.js'
import type { TerminalClipboard } from '../commands.js'
import { DomTerminalRenderer } from '../../../../dist/render/dom/renderer.js'

const cleanups: Array<() => unknown> = []
const decoder = new TextDecoder()
const fontUrl = new URL(
  '../../../../site/public/fonts/jetbrains-mono-latin-400-normal.woff2',
  import.meta.url,
).href
const assets = {
  wasm: new URL('../../../../ghostty-vt.wasm', import.meta.url).href,
  bridge: new URL('../../../../bridge.wasm', import.meta.url).href,
}
beforeAll(async () => {
  document.fonts.add(await new FontFace('Terminal205', `url(${JSON.stringify(fontUrl)})`).load())
})
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function settle(terminal: TerminalApi): Promise<void> {
  await Promise.resolve()
  await terminal.lineCount()
  await Promise.resolve()
}
async function fixture(entry: 'main', platform: KeymapPlatform = 'linux') {
  const host = document.createElement('div')
  host.style.cssText = 'width:400px;height:160px;position:relative'
  document.body.append(host)
  cleanups.push(() => host.remove())
  const appearance = { font: { family: 'Terminal205', size: 14 }, cursor: { blink: false } }
  const terminal: TerminalApi<'sync'> = await MainTerminal.create({
    appearance,
    runtime: { kind: 'owned', options: assets },
    rendererFactory: (options) => DomTerminalRenderer.create(options),
  })
  cleanups.push(() => terminal.dispose())
  const output: string[] = []
  const errors: unknown[] = []
  const copies: string[] = []
  let claims = 0
  let generatedClaims = 0
  terminal.onData((bytes) => output.push(decoder.decode(bytes)))
  terminal.on('error', (error) => errors.push(error))
  terminal.use({
    name: 'claim-counter',
    setup: () => ({
      input: (input) => {
        if (input.type === 'key' && 'input' in input) generatedClaims += 1
        claims += 1
        return 'pass'
      },
    }),
  })
  const clipboard: TerminalClipboard = {
    readText: async () => 'clipboard',
    writeText: async (text) => {
      copies.push(text)
    },
  }
  const common = { clipboard, onError: (cause: unknown) => errors.push(cause) }
  async function standalone(bindings: readonly KeymapEntry[] = []) {
    const handle = terminal.use(hotkeys({ ...common, mode: 'standalone', platform, bindings }))
    expect(handle.api.registration).toBeUndefined()
    await terminal.open(host)
    terminal.focus()
    return handle
  }
  async function hosted(keymap: readonly KeymapEntry[] = [], commands = {}) {
    const dispatcher = createBrowserDispatcher({ platform, keymap })
    cleanups.push(() => dispatcher.dispose())
    const parent = dispatcher.createNode({ context: 'Workspace', commands })
    dispatcher.attachElement(parent, host)
    const handle = terminal.use(
      hotkeys({ ...common, mode: 'hosted', dispatcher, parent, platform }),
    )
    await terminal.open(host)
    terminal.focus()
    return { dispatcher, parent, handle }
  }
  function key(
    type: 'keydown' | 'keyup',
    init: KeyboardEventInit,
    target: HTMLElement = terminal.textarea!,
  ) {
    const event = new KeyboardEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      ...init,
    })
    target.dispatchEvent(event)
    return event
  }
  return {
    terminal,
    host,
    output,
    copies,
    errors,
    key,
    standalone,
    hosted,
    claims: () => claims,
    generatedClaims: () => generatedClaims,
  }
}

describe.each(['main'] as const)('%s public hotkeys extension', (entry) => {
  it('attaches before open and passes unbound input once while a shallower binding owns Ctrl+B', async () => {
    const f = await fixture(entry)
    let calls = 0
    const h = await f.hosted([{ keys: 'Ctrl+B', command: 'sidebar', context: 'Workspace' }], {
      sidebar: () => {
        calls += 1
      },
    })
    expect(h.handle.api.registration?.node.parent).toBe(h.parent)
    f.key('keydown', { key: 'a', code: 'KeyA' })
    f.key('keyup', { key: 'a', code: 'KeyA' })
    f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true })
    f.key('keyup', { key: 'b', code: 'KeyB', ctrlKey: true })
    await settle(f.terminal)
    expect(f.output).toEqual(['a'])
    expect(calls).toBe(1)
    expect(f.errors).toEqual([])
  })

  it('sends deeper shell pack press, repeat and release once with no extension re-entry', async () => {
    const f = await fixture(entry)
    let calls = 0
    const h = await f.hosted(
      [{ keys: 'Ctrl+B', command: 'sidebar', context: 'Workspace' }, ...terminalShellKeysPack],
      {
        sidebar: () => {
          calls += 1
        },
      },
    )
    const observed = new Map<KeyboardEvent, number>()
    h.dispatcher.observeKeys({
      beforeKey: (event) => observed.set(event, (observed.get(event) ?? 0) + 1),
    })
    await f.terminal.write('\x1b[>11u')
    const input = {
      code: 'KeyB',
      composing: false,
      text: 'b',
      modifiers: { control: 'unknown' as const },
    }
    const expected: string[] = []
    for (const action of ['press', 'repeat', 'release'] as const)
      expected.push(
        decoder.decode(
          await f.terminal.sendGeneratedInput({ type: 'key', input: { ...input, action } }),
        ),
      )
    f.output.length = 0
    const claims = f.claims()
    h.dispatcher.claimKeybinding(f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true }))
    h.dispatcher.claimKeybinding(
      f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, repeat: true }),
    )
    h.dispatcher.claimKeybinding(f.key('keyup', { key: 'b', code: 'KeyB', ctrlKey: true }))
    await settle(f.terminal)
    expect(f.output).toEqual(expected)
    expect(calls).toBe(0)
    expect(f.claims() - claims).toBe(2)
    expect(f.generatedClaims()).toBe(0)
    expect([...observed.values()]).toEqual([1, 1, 1])
    expect(f.errors).toEqual([])
  })

  it('reads confirmed alternate-screen and mouse context before matching each event', async () => {
    const f = await fixture(entry)
    await f.hosted([
      {
        keys: 'Ctrl+B',
        command: 'terminal.sendKeystroke',
        args: { text: 'normal' },
        context: 'Terminal && mode == normal && mouse == off',
      },
      {
        keys: 'Ctrl+B',
        command: 'terminal.sendKeystroke',
        args: { text: 'alternate' },
        context: 'Terminal && mode == alternate && mouse == on',
      },
    ])
    f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true })
    f.key('keyup', { key: 'b', code: 'KeyB', ctrlKey: true })
    await f.terminal.write('\x1b[?1049h\x1b[?1000h')
    expect(f.terminal.inputModes).toEqual({ alternateScreen: true, mouseReporting: true })
    f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true })
    f.key('keyup', { key: 'b', code: 'KeyB', ctrlKey: true })
    await f.terminal.write('\x1b[?1049l\x1b[?1000l')
    expect(f.terminal.inputModes).toEqual({ alternateScreen: false, mouseReporting: false })
    expect(f.output).toEqual(['normal', 'alternate'])
    expect(f.errors).toEqual([])
  })

  it('commits composing text once and lets native protocol replies bypass claims', async () => {
    const f = await fixture(entry)
    await f.hosted([
      {
        keys: 'Ctrl+B',
        command: 'terminal.sendKeystroke',
        args: { text: 'wrong' },
        context: 'Terminal',
      },
    ])
    const textarea = f.terminal.textarea!
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    f.key('keydown', {
      key: 'Process',
      code: 'KeyB',
      ctrlKey: true,
      isComposing: true,
      keyCode: 229,
    })
    textarea.value = '汉字'
    textarea.dispatchEvent(
      new InputEvent('input', {
        data: '汉字',
        inputType: 'insertCompositionText',
        isComposing: true,
        bubbles: true,
      }),
    )
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '汉字', bubbles: true }))
    textarea.value = '汉字'
    textarea.dispatchEvent(
      new InputEvent('input', { data: '汉字', inputType: 'insertCompositionText', bubbles: true }),
    )
    f.key('keyup', { key: 'Process', code: 'KeyB', ctrlKey: true })
    await settle(f.terminal)
    expect(f.output).toEqual(['汉字'])
    const claims = f.claims()
    await f.terminal.write('\x1b[6n')
    expect(f.output.length).toBe(2)
    expect(f.output[1]?.startsWith('\x1b')).toBe(true)
    expect(f.output[1]?.slice(1)).toMatch(/^\[\d+;\d+R$/)
    expect(f.claims()).toBe(claims)
    expect(f.errors).toEqual([])
  })

  it('keeps a mapped press owner across focus movement and forwards its release once', async () => {
    const f = await fixture(entry)
    const h = await f.hosted([
      {
        keys: 'Ctrl+B',
        command: 'terminal.sendKeystroke',
        args: { keystroke: 'Ctrl+C' },
        context: 'Terminal',
      },
    ])
    await f.terminal.write('\x1b[>11u')
    f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true })
    h.dispatcher.focus(h.parent)
    f.key('keyup', { key: 'b', code: 'KeyB', ctrlKey: true }, f.host)
    f.key('keyup', { key: 'b', code: 'KeyB', ctrlKey: true }, f.host)
    await settle(f.terminal)
    expect(f.output).toHaveLength(2)
    expect(f.output[0]).toContain('99;5')
    expect(f.output[1]).toContain('99;5:3')
  })

  it.each(['blur', 'hidden', 'releaseAll', 'dispose'] as const)(
    '%s clears native ownership before a later release',
    async (reason) => {
      const f = await fixture(entry)
      const h = await f.hosted(terminalShellKeysPack)
      await f.terminal.write('\x1b[>11u')
      f.key('keydown', { key: 'b', code: 'KeyB', ctrlKey: true })
      await settle(f.terminal)
      if (reason === 'releaseAll') h.dispatcher.releaseAll()
      if (reason === 'dispose') {
        h.handle.dispose()
        expect(h.dispatcher.dispatchCommand('terminal.sendKeystroke', { text: 'late' })).toBe(false)
        expect(h.dispatcher.focused()).toBe(h.parent)
      }
      if (reason === 'blur') window.dispatchEvent(new Event('blur'))
      if (reason === 'hidden') {
        const previous = Object.getOwnPropertyDescriptor(document, 'visibilityState')
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
        if (previous) Object.defineProperty(document, 'visibilityState', previous)
        else Reflect.deleteProperty(document, 'visibilityState')
      }
      f.key('keyup', { key: 'b', code: 'KeyB', ctrlKey: true })
      await settle(f.terminal)
      expect(f.output).toHaveLength(1)
      expect(f.errors).toEqual([])
    },
  )

  it.each(['linux', 'windows', 'mac'] as const)(
    '%s standalone defaults and a user override work through the public factory',
    async (platform) => {
      const f = await fixture(entry, platform)
      const handle = await f.standalone([
        {
          keys: 'Ctrl+Q',
          command: 'terminal.sendKeystroke',
          args: { text: 'override' },
          context: 'Terminal',
          source: 'user',
        },
      ])
      expect(handle.api.registration).toBeDefined()
      await f.terminal.write('selection')
      f.key('keydown', {
        key: 'a',
        code: 'KeyA',
        ...(platform === 'mac' ? { metaKey: true } : { ctrlKey: true, shiftKey: true }),
      })
      f.key('keyup', {
        key: 'a',
        code: 'KeyA',
        ...(platform === 'mac' ? { metaKey: true } : { ctrlKey: true, shiftKey: true }),
      })
      await expect.poll(() => f.terminal.getSelection()).toBeDefined()
      const clipboardModifiers =
        platform === 'mac' ? { metaKey: true } : { ctrlKey: true, shiftKey: true }
      f.key('keydown', { key: 'c', code: 'KeyC', ...clipboardModifiers })
      f.key('keydown', { key: 'c', code: 'KeyC', repeat: true, ...clipboardModifiers })
      f.key('keyup', { key: 'c', code: 'KeyC', ...clipboardModifiers })
      await expect.poll(() => f.copies.length).toBe(1)
      expect(f.copies[0]).toContain('selection')
      await f.terminal.write('\x1b[?2004h')
      f.key('keydown', { key: 'v', code: 'KeyV', ...clipboardModifiers })
      f.key('keydown', { key: 'v', code: 'KeyV', repeat: true, ...clipboardModifiers })
      f.key('keyup', { key: 'v', code: 'KeyV', ...clipboardModifiers })
      await expect.poll(() => f.output).toEqual(['\x1b[200~clipboard\x1b[201~'])
      const modifier = platform === 'mac' ? { metaKey: true } : { ctrlKey: true }
      f.key('keydown', { key: '=', code: 'Equal', ...modifier })
      f.key('keydown', { key: '=', code: 'Equal', repeat: true, ...modifier })
      f.key('keyup', { key: '=', code: 'Equal', ...modifier })
      await expect.poll(() => f.terminal.appearance.font.size).toBe(16)
      f.key('keydown', { key: '0', code: 'Digit0', ...modifier })
      f.key('keyup', { key: '0', code: 'Digit0', ...modifier })
      await expect.poll(() => f.terminal.appearance.font.size).toBe(14)
      f.key('keydown', { key: '-', code: 'Minus', ...modifier })
      f.key('keyup', { key: '-', code: 'Minus', ...modifier })
      await expect.poll(() => f.terminal.appearance.font.size).toBe(13)
      await f.terminal.write('\x1b[?1000h')
      f.key('keydown', { key: 'k', code: 'KeyK', ...clipboardModifiers })
      f.key('keyup', { key: 'k', code: 'KeyK', ...clipboardModifiers })
      await settle(f.terminal)
      expect((await f.terminal.readLines(0, 1))[0]?.text.trim()).toBe('')
      expect(f.terminal.inputModes.mouseReporting).toBe(true)
      handle.dispose()
      f.terminal.use(
        hotkeys({
          mode: 'standalone',
          platform,
          bindings: [
            {
              keys: platform === 'mac' ? 'Meta+K' : 'Ctrl+Shift+K',
              command: 'terminal.sendKeystroke',
              args: { text: 'default overridden' },
              context: 'Terminal',
              source: 'user',
            },
          ],
        }),
      )
      f.key('keydown', { key: 'k', code: 'KeyK', ...clipboardModifiers })
      f.key('keyup', { key: 'k', code: 'KeyK', ...clipboardModifiers })
      await settle(f.terminal)
      expect(f.output.at(-1)).toBe('default overridden')
      f.key('keydown', { key: 'q', code: 'KeyQ', ctrlKey: true })
      f.key('keyup', { key: 'q', code: 'KeyQ', ctrlKey: true })
      await settle(f.terminal)
      expect(f.output.at(-1)).toBe('\x11')
      expect(terminalDefaultPack[platform]).toHaveLength(8)
      expect(f.errors).toEqual([])
    },
  )

  it('attaches after open, removes its node/commands, cancels clipboard completion and leaves native authority live', async () => {
    const f = await fixture(entry)
    await f.terminal.open(f.host)
    let resolveClipboard: ((value: string) => void) | undefined
    const pending = new Promise<string>((resolve) => {
      resolveClipboard = resolve
    })
    const handle = f.terminal.use(
      hotkeys({
        mode: 'standalone',
        platform: 'linux',
        clipboard: { readText: () => pending, writeText: async () => {} },
      }),
    )
    f.terminal.focus()
    f.key('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, shiftKey: true })
    handle.dispose()
    handle.dispose()
    resolveClipboard!('late')
    await settle(f.terminal)
    expect(f.output).toEqual([])
    f.key('keydown', { key: 'z', code: 'KeyZ' })
    await settle(f.terminal)
    expect(f.output).toEqual(['z'])
    await f.terminal.write('still alive')
    expect(f.terminal.lifecycle).toBe('open')
    expect((await f.terminal.readLines(0, 1))[0]?.text).toContain('still alive')
    await expect.poll(() => f.terminal.visibleLines().join('')).toContain('still alive')
    await page.screenshot({
      element: f.terminal.element!,
      path: `../../../../.artifacts/terminal205-${entry}.png`,
      scale: 'css',
    })
    expect(f.errors).toEqual([])
  })
})
