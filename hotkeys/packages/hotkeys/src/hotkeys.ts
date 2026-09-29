import { Store } from '@tanstack/store'
import { createBrowserDispatcher } from './adapters/browser-dispatcher'
import { keyInputFromKeyboardEvent } from './adapters/browser'
import { isRecordingEvent } from './_recording-guard'
import { shouldIgnoreInputEvent } from './_event-target'
import { getDefaultIgnoreInputs, handleConflict, optionsEqual } from './_registration'
import { matchesKeyInput } from './match'
import { isModifierKey, normalizeRegisterableHotkey, parseRegisterableHotkey } from './parse'
import { detectPlatform } from './platform'
import type { BrowserDispatcher } from './adapters/browser-dispatcher'
import type { FocusNode } from './dispatch/dispatcher'
import type { KeyInput } from './key-input'
import type { KeymapEntry } from './dispatch/keymap'
import type {
  ConflictBehavior,
  Hotkey,
  HotkeyCallback,
  HotkeyMeta,
  ParsedHotkey,
  RawHotkey,
  RegisterableHotkey,
} from './hotkey.types'

export type { ConflictBehavior }
export type Target = HTMLElement | Document | Window
/** One stroke, or several pressed in turn (`['Mod+K', 'Mod+C']`). */
export type HotkeyKeys = RegisterableHotkey | readonly RegisterableHotkey[]

export interface HotkeyOptions {
  /** What a second registration of the same keys on the same target does. Defaults to 'warn'. */
  conflictBehavior?: ConflictBehavior
  /** False keeps the registration listed while it does not fire. */
  enabled?: boolean
  eventType?: 'keydown' | 'keyup'
  /** Skip the hotkey while typing. Defaults to true for bare keys and Shift/Alt chords. */
  ignoreInputs?: boolean
  /** Resolves `Mod` for this registration. */
  platform?: 'mac' | 'windows' | 'linux'
  preventDefault?: boolean
  /** Fire once per press; holding the key does not repeat it. */
  requireReset?: boolean
  stopPropagation?: boolean
  /** Fire only for keys inside this element. Defaults to the document. */
  target?: Target | null
  meta?: HotkeyMeta
}
export interface HotkeyRegistrationView {
  readonly id: string
  /** Normalized strokes separated by spaces, such as `Mod+K Mod+C`. */
  readonly hotkey: string
  readonly strokes: readonly ParsedHotkey[]
  readonly options: HotkeyOptions
  readonly target: Target
  readonly triggerCount: number
}
export interface HotkeyRegistrationHandle {
  /** Settable, so a component can swap its callback without registering again. */
  callback: HotkeyCallback
  readonly id: string
  readonly isActive: boolean
  setOptions: (options: Partial<HotkeyOptions>) => void
  unregister: () => void
}
export type HotkeyRegistry = {
  readonly register: (
    keys: HotkeyKeys,
    callback: HotkeyCallback,
    options?: HotkeyOptions,
  ) => HotkeyRegistrationHandle
  /** Views for devtools and palettes; changes on register, unregister, option change and trigger. */
  readonly registrations: Store<ReadonlyMap<string, HotkeyRegistrationView>>
  /** Runs a registration's callback without a key, as devtools do. */
  readonly trigger: (id: string) => boolean
  /** The dispatcher underneath, for hosts that add focus nodes or read pending chords. */
  readonly dispatcher: BrowserDispatcher
  readonly dispose: () => void
}

type Registration = {
  readonly id: string
  readonly strokes: readonly RawHotkey[]
  readonly parsed: readonly ParsedHotkey[]
  readonly hotkey: string
  readonly target: Target
  callback: HotkeyCallback
  options: HotkeyOptions
  hasFired: boolean
  triggerCount: number
}

let nextId = 0

/**
 * Registers hotkeys on one document through a {@link BrowserDispatcher}: the newest registration
 * for a key runs first, a callback returning false passes the key on, and multi-stroke keys
 * are chords with Zed's pending rules.
 */
export function createHotkeyRegistry(
  options: { readonly document?: Document; readonly timeoutMs?: number } = {},
): HotkeyRegistry {
  const doc = options.document ?? document
  const entries = new Map<string, Registration>()
  const registrations = new Store<ReadonlyMap<string, HotkeyRegistrationView>>(new Map())
  let dirty = false
  // Listening before the dispatcher does: it swallows the release of a key it claimed.
  doc.addEventListener('keyup', onKeyUp, true)
  const dispatcher = createBrowserDispatcher({
    root: doc,
    // Registrations carry explicit modifiers; the dispatcher's own `Mod` is never used.
    platform: detectPlatform(),
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    beforeKey: syncKeymap,
  })
  const root: FocusNode<KeyboardEvent> = dispatcher.createNode()
  dispatcher.focus(root)

  function syncKeymap() {
    if (!dirty) return
    dirty = false
    const keymap: KeymapEntry[] = []
    for (const entry of entries.values()) {
      if (entry.options.enabled === false || entry.options.eventType === 'keyup') continue
      keymap.push({
        keys: entry.strokes as unknown as readonly [RawHotkey, ...RawHotkey[]],
        command: entry.id,
        ...(entry.options.preventDefault === false && { preventDefault: false }),
        ...(entry.options.stopPropagation === false && { stopPropagation: false }),
      })
    }
    dispatcher.setKeymap(keymap)
  }
  function publish() {
    dirty = true
    const views = new Map<string, HotkeyRegistrationView>()
    for (const entry of entries.values()) views.set(entry.id, view(entry))
    registrations.setState(() => views)
  }
  function fire(entry: Registration, event: KeyboardEvent) {
    entry.hasFired = true
    entry.triggerCount += 1
    registrations.setState((previous) => new Map(previous).set(entry.id, view(entry)))
    const [first] = entry.parsed
    return entry.callback(event, { hotkey: entry.hotkey as Hotkey, parsedHotkey: first! })
  }
  function accepts(entry: Registration, event: KeyboardEvent): boolean {
    if (isRecordingEvent(event)) return false
    if (!isInsideTarget(event, entry.target)) return false
    if (entry.options.ignoreInputs && shouldIgnoreInputEvent(event, doc, entry.target)) return false
    return true
  }
  function run(entry: Registration, event: KeyboardEvent): boolean {
    if (!accepts(entry, event)) return false
    if (entry.options.requireReset && entry.hasFired) return true
    return fire(entry, event) !== false
  }
  function onKeyUp(event: KeyboardEvent) {
    const input = keyInputFromKeyboardEvent(event)
    for (const entry of entries.values()) {
      if (entry.options.eventType === 'keyup') {
        runKeyUp(entry, event)
        continue
      }
      // A release of the key or of any modifier re-arms a requireReset hotkey.
      if (entry.hasFired && (isModifierKey(input.key) || releases(entry.parsed.at(-1)!, input)))
        entry.hasFired = false
    }
  }
  function runKeyUp(entry: Registration, event: KeyboardEvent) {
    if (entry.options.enabled === false || entry.strokes.length !== 1) return
    const input = { ...keyInputFromKeyboardEvent(event), type: 'keydown' as const }
    if (!matchesKeyInput(input, entry.parsed[0]!, entry.options.platform)) return
    if (!accepts(entry, event)) return
    if (entry.options.preventDefault !== false) event.preventDefault()
    if (entry.options.stopPropagation !== false) event.stopPropagation()
    fire(entry, event)
  }
  function register(
    keys: HotkeyKeys,
    callback: HotkeyCallback,
    registrationOptions: HotkeyOptions = {},
  ): HotkeyRegistrationHandle {
    const id = `hotkey_${++nextId}`
    const platform = registrationOptions.platform ?? detectPlatform()
    const list = (Array.isArray(keys) ? keys : [keys]) as readonly RegisterableHotkey[]
    const parsed = list.map((stroke) => parseRegisterableHotkey(stroke, platform))
    const target = registrationOptions.target ?? doc
    const hotkey = list.map((stroke) => normalizeRegisterableHotkey(stroke, platform)).join(' ')
    const existing = [...entries.values()].find(
      (entry) =>
        entry.hotkey === hotkey &&
        entry.target === target &&
        (entry.options.eventType ?? 'keydown') === (registrationOptions.eventType ?? 'keydown'),
    )
    if (existing)
      handleConflict(existing.id, hotkey, registrationOptions.conflictBehavior ?? 'warn', remove)
    const entry: Registration = {
      id,
      strokes: parsed.map(explicitStroke),
      parsed,
      hotkey,
      target,
      callback,
      options: {
        ...registrationOptions,
        platform,
        ignoreInputs: registrationOptions.ignoreInputs ?? getDefaultIgnoreInputs(parsed[0]!),
      },
      hasFired: false,
      triggerCount: 0,
    }
    entries.set(id, entry)
    root.handle(id, ({ source }) => (source ? run(entry, source) : false))
    publish()
    return {
      id,
      get callback() {
        return entry.callback
      },
      set callback(next: HotkeyCallback) {
        entry.callback = next
      },
      get isActive() {
        return entries.get(id) === entry
      },
      setOptions: (next) => {
        const merged = { ...entry.options, ...next }
        if (optionsEqual(entry.options, merged)) return
        entry.options = merged
        publish()
      },
      unregister: () => remove(id),
    }
  }
  function remove(id: string) {
    if (!entries.delete(id)) return
    publish()
  }
  function trigger(id: string): boolean {
    const entry = entries.get(id)
    if (!entry) return false
    const last = entry.parsed.at(-1)!
    // A synthesized event carries the code, never a guessed character.
    fire(
      entry,
      new KeyboardEvent('keydown', {
        key: last.key ?? '',
        code: last.code ?? '',
        ctrlKey: last.ctrl,
        shiftKey: last.shift,
        altKey: last.alt,
        metaKey: last.meta,
      }),
    )
    return true
  }
  const registry: HotkeyRegistry = {
    register,
    registrations,
    trigger,
    dispatcher,
    dispose: () => {
      if (registries.get(doc) === registry) registries.delete(doc)
      doc.removeEventListener('keyup', onKeyUp, true)
      dispatcher.dispose()
      entries.clear()
      registrations.setState(() => new Map())
    },
  }
  return registry
}

function view(entry: Registration): HotkeyRegistrationView {
  return {
    id: entry.id,
    hotkey: entry.hotkey,
    strokes: entry.parsed,
    options: entry.options,
    target: entry.target,
    triggerCount: entry.triggerCount,
  }
}

// Resolves Mod now, so one dispatcher serves registrations made for different platforms.
function explicitStroke(parsed: ParsedHotkey): RawHotkey {
  const modifiers = { ctrl: parsed.ctrl, shift: parsed.shift, alt: parsed.alt, meta: parsed.meta }
  return parsed.code === undefined
    ? ({ key: parsed.key, ...modifiers } as RawHotkey)
    : ({ code: parsed.code, ...modifiers } as RawHotkey)
}

function releases(stroke: ParsedHotkey, input: KeyInput): boolean {
  return stroke.code === undefined ? stroke.key === input.key : stroke.code === input.code
}

function isInsideTarget(event: KeyboardEvent, target: Target): boolean {
  if (!('nodeType' in target) || target.nodeType === 9) return true
  return event.composedPath().includes(target)
}

const registries = new WeakMap<Document, HotkeyRegistry>()

/** The registry for a document, created on first use. */
export function getHotkeyRegistry(doc: Document = document): HotkeyRegistry {
  let registry = registries.get(doc)
  if (!registry) registries.set(doc, (registry = createHotkeyRegistry({ document: doc })))
  return registry
}
