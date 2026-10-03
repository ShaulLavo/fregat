import {
  createBrowserDispatcher,
  detectPlatform,
  normalizeHotkey,
  normalizeHotkeyFromEvent,
  type BrowserDispatcher,
  type FocusNode,
  type KeymapEntry,
  type KeymapPlatform,
} from '@fregat/hotkeys'
import { createTerminalCommands, type TerminalCommandOptions } from './commands.js'
import { terminalKeyContext, type TerminalKeyContextState } from './context.js'
import {
  normalizeTerminalKeystroke,
  readSendKeystrokeArgs,
  terminalKeyFromEvent,
  terminalKeystroke,
} from './keystroke.js'
import { terminalDefaultPack } from './packs.js'
import type { TerminalKeyInput } from '../../term/types.js'

type TerminalHotkeyOwnership =
  | {
      readonly mode: 'standalone'
      readonly bindings?: readonly KeymapEntry[]
      readonly platform?: KeymapPlatform
    }
  | {
      readonly mode: 'hosted'
      readonly dispatcher: BrowserDispatcher
      readonly parent: FocusNode<KeyboardEvent>
      readonly platform: KeymapPlatform
      readonly observeKeys: (observer: (event: KeyboardEvent) => void) => () => void
    }

export type TerminalHotkeyRegistrationOptions = TerminalHotkeyOwnership &
  Omit<TerminalCommandOptions, 'sendKeystroke'> & {
    readonly element: HTMLElement
    readonly readState: () => TerminalKeyContextState
  }

export interface TerminalHotkeyRegistration {
  readonly node: FocusNode<KeyboardEvent>
  claim(event: KeyboardEvent): 'claim' | 'pass'
  dispose(): void
}

export function registerTerminalHotkeys(
  options: TerminalHotkeyRegistrationOptions,
): TerminalHotkeyRegistration {
  const platform = options.platform ?? detectPlatform()
  const lifetime = new AbortController()
  let disposed = false
  let offered: KeyboardEvent | undefined
  const nativePresses = new Map<
    string,
    { readonly input: TerminalKeyInput; readonly sourceRelease: boolean }
  >()
  const nativePassed = new WeakSet<KeyboardEvent>()
  const nativeSent = new WeakSet<KeyboardEvent>()
  const dispatcher =
    options.mode === 'hosted'
      ? options.dispatcher
      : createBrowserDispatcher({
          root: options.element,
          platform,
          keymap: [...terminalDefaultPack[platform], ...(options.bindings ?? [])],
          beforeKey: observeKey,
          replay: (_input, event) =>
            send(() => options.terminal.key(terminalKeyFromEvent(event, platform))),
        })
  const commands = createTerminalCommands({
    ...options,
    signal: lifetime.signal,
    sendKeystroke: (event) => {
      if (options.signal.aborted || disposed) return false
      const args = readSendKeystrokeArgs(event.args)
      if (!args) return false
      if ('text' in args) {
        send(() => options.terminal.sendInput(args.text))
        return true
      }
      const keys = normalizeTerminalKeystroke(args.keystroke)
      const source = event.source
      if (
        source &&
        normalizeHotkey(keys, platform) === normalizeHotkeyFromEvent(source, platform)
      ) {
        nativePresses.set(source.code, {
          input: terminalKeyFromEvent(source, platform),
          sourceRelease: true,
        })
        if (source === offered) nativePassed.add(source)
        else {
          nativeSent.add(source)
          send(() => options.terminal.key(terminalKeyFromEvent(source, platform)))
        }
        return true
      }
      const input = terminalKeystroke(keys, platform)
      if (!input) return false
      const encoded = source?.repeat ? { ...input, action: 'repeat' as const } : input
      if (source) nativePresses.set(source.code, { input: encoded, sourceRelease: false })
      send(() => options.terminal.key(encoded))
      return true
    },
  })
  const node = dispatcher.createNode({
    parent: options.mode === 'hosted' ? options.parent : null,
    readContext: () => terminalKeyContext(options.readState()),
    commands,
  })
  const detach = dispatcher.attachElement(node, options.element)
  const unobserve = options.mode === 'hosted' ? options.observeKeys(observeKey) : () => {}

  function send(run: () => unknown): void {
    if (disposed || options.signal.aborted) return
    perform(run)
  }
  function perform(run: () => unknown): void {
    try {
      void Promise.resolve(run()).catch((cause: unknown) =>
        options.onError(cause, 'terminal.sendKeystroke'),
      )
    } catch (cause) {
      options.onError(cause, 'terminal.sendKeystroke')
    }
  }
  function observeKey(event: KeyboardEvent): void {
    if (event.type !== 'keyup' || !nativePresses.has(event.code)) return
    const mapped = nativePresses.get(event.code)
    nativePresses.delete(event.code)
    const input =
      mapped && !mapped.sourceRelease
        ? { ...mapped.input, action: 'release' as const }
        : terminalKeyFromEvent(event, platform)
    // The shared dispatcher swallows claimed releases at document capture.
    nativeSent.add(event)
    send(() => options.terminal.key(input))
  }
  function claim(event: KeyboardEvent): 'claim' | 'pass' {
    if (disposed || options.signal.aborted) return 'pass'
    offered = event
    const claimed = dispatcher.claimKeybinding(event)
    offered = undefined
    if (nativeSent.has(event)) return 'claim'
    if (nativePassed.has(event)) return 'pass'
    return claimed ? 'claim' : 'pass'
  }
  function dispose(): void {
    if (disposed) return
    lifetime.abort()
    for (const { input } of nativePresses.values())
      perform(() => options.terminal.key({ ...input, action: 'release' }))
    disposed = true
    nativePresses.clear()
    options.signal.removeEventListener('abort', dispose)
    unobserve()
    detach()
    node.remove()
    if (options.mode === 'standalone') dispatcher.dispose()
  }
  options.signal.addEventListener('abort', dispose, { once: true })
  if (options.signal.aborted) dispose()
  return { node, claim, dispose }
}
