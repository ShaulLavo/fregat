import { afterEach, expect, test, vi } from 'vitest'
import { createKeymapRuntime } from '../src/keymap/runtime'
import { defaultEditorKeyBindings } from '../src/keymap/presets'
import type { KeymapBinding, KeymapRuntime, KeymapSequenceEvent } from '../src/keymap/types'

let runtime: KeymapRuntime<string> | undefined
const bindings: readonly KeymapBinding<string>[] = [
  { chord: ['Control+K', 'Control+C'], payload: 'comment' },
  { chord: ['Control+K', 'Control+D', 'Control+E'], payload: 'deep' },
  { chord: ['Tab'], payload: 'tab' },
]
afterEach(() => {
  runtime?.dispose()
  runtime = undefined
  vi.useRealTimers()
  document.body.replaceChildren()
})
function key(key: string, init: KeyboardEventInit = {}, type = 'keydown') {
  return new KeyboardEvent(type, {
    key,
    code: `Key${key.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    ...init,
  })
}
function setup(table = bindings) {
  const calls: string[] = []
  const events: KeymapSequenceEvent<string>[] = []
  let available = true
  let captures = 0
  runtime = createKeymapRuntime({
    root: document,
    platform: 'linux',
    bindings: table,
    captureContext: () => {
      captures++
      return available
    },
    isAvailable: (_binding, context) => context,
    dispatch: ({ payload }) => {
      calls.push(payload)
      return payload !== 'tab'
    },
    onSequence: (event) => events.push(event),
  })
  return {
    calls,
    events,
    setAvailable: (value: boolean) => {
      available = value
    },
    captures: () => captures,
    claim: (event: KeyboardEvent) => runtime!.claimKeybinding(event),
  }
}

test('direct forwarded event identity runs once before later DOM dispatch', () => {
  const h = setup([{ chord: ['Control+C'], payload: 'copy' }])
  const event = key('c', { ctrlKey: true })
  expect(h.claim(event)).toBe(true)
  document.dispatchEvent(event)
  expect(h.claim(event)).toBe(true)
  expect(h.calls).toEqual(['copy'])
})
test('unavailable prefixes and declined single shortcuts pass through', () => {
  const h = setup()
  h.setAvailable(false)
  const prefix = key('k', { ctrlKey: true })
  expect(h.claim(prefix)).toBe(false)
  expect(prefix.defaultPrevented).toBe(false)
  h.setAvailable(true)
  const tab = key('Tab', { code: 'Tab' })
  expect(h.claim(tab)).toBe(false)
  expect(tab.defaultPrevented).toBe(false)
})
test('availability is fresh at continuation and an unavailable completion is consumed', () => {
  const h = setup()
  expect(h.claim(key('k', { ctrlKey: true }))).toBe(true)
  h.setAvailable(false)
  const continuation = key('c', { ctrlKey: true })
  expect(h.claim(continuation)).toBe(true)
  expect(continuation.defaultPrevented).toBe(true)
  expect(h.calls).toEqual([])
  expect(h.events[0]?.outcome).toBe('unavailable')
  expect(h.captures()).toBe(2)
})
test('conditional candidates survive exact matches and share one captured context', () => {
  const table: readonly KeymapBinding<string>[] = [
    { chord: ['Control+K'], payload: 'tab' },
    { chord: ['Control+K'], payload: 'single' },
    ...bindings,
  ]
  const h = setup(table)
  h.claim(key('k', { ctrlKey: true }))
  expect(h.calls).toEqual(['tab', 'single'])
  expect(h.captures()).toBe(1)
  expect(h.events).toEqual([])
})
test('ineligible singles preserve deeper prefixes; deeper sequences execute', () => {
  const calls: string[] = []
  runtime = createKeymapRuntime({
    root: document,
    bindings: [{ chord: ['Control+K'], payload: 'single' }, ...bindings],
    captureContext: () => null,
    isAvailable: (binding) => binding.payload !== 'single',
    dispatch: (binding) => {
      calls.push(binding.payload)
      return true
    },
  })
  runtime.claimKeybinding(key('k', { ctrlKey: true }))
  runtime.claimKeybinding(key('d', { ctrlKey: true }))
  runtime.claimKeybinding(key('e', { ctrlKey: true }))
  expect(calls).toEqual(['deep'])
})
test('real scheduled timer does not depend on another event and repeats do not extend it', () => {
  vi.useFakeTimers()
  const h = setup()
  h.claim(key('k', { ctrlKey: true }))
  vi.advanceTimersByTime(4000)
  h.claim(key('k', { ctrlKey: true, repeat: true }))
  vi.advanceTimersByTime(1000)
  expect(h.events[0]?.outcome).toBe('timeout')
  const repeat = key('k', { repeat: true })
  expect(h.claim(repeat)).toBe(true)
  expect(h.claim(key('k', {}, 'keyup'))).toBe(true)
})
test.each(['blur', 'pointer', 'hidden'] as const)('%s cancels pending state', (outcome) => {
  const h = setup()
  h.claim(key('k', { ctrlKey: true }))
  if (outcome === 'blur') window.dispatchEvent(new Event('blur'))
  if (outcome === 'pointer') document.dispatchEvent(new Event('pointerdown'))
  if (outcome === 'hidden') {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  }
  h.claim(key('c', { ctrlKey: true }))
  expect(h.calls).toEqual([])
  expect(h.events[0]?.outcome).toBe(outcome)
})
test.each([
  { key: 'я', code: 'KeyK' },
  { key: 'ל', code: 'KeyK' },
])('physical fallback supports $key', (stroke) => {
  const h = setup()
  expect(h.claim(key(stroke.key, { code: stroke.code, ctrlKey: true }))).toBe(true)
  h.claim(key('c', { ctrlKey: true }))
  expect(h.calls).toEqual(['comment'])
})
test('Latin printed layout guard and composition do not arm', () => {
  const h = setup()
  expect(h.claim(key('z', { code: 'KeyK', ctrlKey: true }))).toBe(false)
  expect(h.claim(key('k', { ctrlKey: true, isComposing: true }))).toBe(false)
  expect(h.claim(key('k', { ctrlKey: true, keyCode: 229 }))).toBe(false)
})
test('disabled ownership swallows repeats and release until re-enabled', () => {
  const h = setup()
  h.claim(key('k', { ctrlKey: true }))
  runtime!.setEnabled(false)
  expect(h.claim(key('k', { repeat: true }))).toBe(true)
  expect(h.claim(key('k', {}, 'keyup'))).toBe(true)
  expect(h.claim(key('k', { ctrlKey: true }))).toBe(false)
  runtime!.setEnabled(true)
  h.claim(key('k', { ctrlKey: true }))
  h.claim(key('c', { ctrlKey: true }))
  expect(h.calls).toEqual(['comment'])
})
test('element roots keep idle matching scoped and remember a declined event identity', () => {
  const root = document.createElement('div')
  document.body.append(root)
  let calls = 0
  runtime = createKeymapRuntime({
    root,
    bindings: [{ chord: ['Control+C'], payload: 'copy' }],
    captureContext: () => null,
    isAvailable: () => true,
    dispatch: () => {
      calls++
      return true
    },
  })
  const event = key('c', { ctrlKey: true })
  expect(runtime.claimKeybinding(event)).toBe(false)
  root.dispatchEvent(event)
  expect(calls).toBe(0)
  root.dispatchEvent(key('c', { ctrlKey: true }))
  expect(calls).toBe(1)
})

test('declined eligible terminal candidates do not arm a longer sequence', () => {
  const h = setup([{ chord: ['Control+K'], payload: 'tab' }, ...bindings])
  const event = key('k', { ctrlKey: true })
  expect(h.claim(event)).toBe(false)
  expect(event.defaultPrevented).toBe(false)
  expect(h.calls).toEqual(['tab'])
  expect(h.claim(key('c', { ctrlKey: true }))).toBe(false)
  expect(h.events).toEqual([])
})

test('synchronous target cancellation during a declined completion retains event ownership', () => {
  runtime = createKeymapRuntime({
    root: document,
    bindings,
    captureContext: () => null,
    isAvailable: () => true,
    dispatch: () => {
      runtime!.cancel()
      return false
    },
  })
  runtime.claimKeybinding(key('k', { ctrlKey: true }))
  expect(runtime.claimKeybinding(key('c', { ctrlKey: true }))).toBe(true)
  expect(runtime.claimKeybinding(key('c', {}, 'keyup'))).toBe(true)
})

test('a completion that synchronously moves focus reports completed once', () => {
  const outcomes: string[] = []
  runtime = createKeymapRuntime({
    root: document,
    bindings,
    captureContext: () => null,
    isAvailable: () => true,
    dispatch: () => {
      runtime!.cancel()
      return true
    },
    onSequence: (event) => outcomes.push(event.outcome),
  })
  runtime.claimKeybinding(key('k', { ctrlKey: true }))
  expect(runtime.claimKeybinding(key('c', { ctrlKey: true }))).toBe(true)
  expect(outcomes).toEqual(['completed'])
})

test.each(['preventDefault', 'stopPropagation'] as const)(
  'explicit %s owns a declined single and its release',
  (option) => {
    const h = setup([{ chord: ['F2'], payload: 'tab', [option]: true }])
    const event = key('F2', { code: 'F2' })
    expect(h.claim(event)).toBe(true)
    expect(event.defaultPrevented).toBe(option === 'preventDefault')
    expect(h.claim(key('F2', { code: 'F2' }, 'keyup'))).toBe(true)
  },
)

test('explicit event ownership survives ordered fallback when every command declines', () => {
  const calls: string[] = []
  runtime = createKeymapRuntime({
    root: document,
    bindings: [
      { chord: ['F2'], payload: 'first', preventDefault: true },
      { chord: ['F2'], payload: 'second' },
    ],
    captureContext: () => null,
    isAvailable: () => true,
    dispatch: ({ payload }) => {
      calls.push(payload)
      return false
    },
  })
  const event = key('F2', { code: 'F2' })
  expect(runtime.claimKeybinding(event)).toBe(true)
  expect(event.defaultPrevented).toBe(true)
  expect(calls).toEqual(['first', 'second'])
})

test.each(['windows', 'linux'] as const)(
  '%s keeps horizontal column selection on arrows beside jump and word-part bindings',
  (platform) => {
    const calls: string[] = []
    runtime = createKeymapRuntime<string, null>({
      root: document,
      platform,
      bindings: defaultEditorKeyBindings(platform).map((binding) => ({
        ...binding,
        payload: binding.command,
      })),
      captureContext: () => null,
      isAvailable: () => true,
      dispatch: ({ payload }) => {
        calls.push(payload)
        return true
      },
    })
    for (const arrow of ['ArrowLeft', 'ArrowRight']) {
      runtime.claimKeybinding(key('k', { ctrlKey: true }))
      runtime.claimKeybinding(key(arrow, { altKey: true }))
      runtime.claimKeybinding(key(arrow, { altKey: true }))
      runtime.claimKeybinding(key(arrow, { ctrlKey: true, altKey: true, shiftKey: true }))
      runtime.claimKeybinding(key(arrow, { altKey: true, shiftKey: true }))
    }
    expect(calls).toEqual([
      'cursorColumnSelectLeft',
      'jumpBack',
      'cursorWordPartLeftSelect',
      'editor.action.smartSelect.shrink',
      'cursorColumnSelectRight',
      'jumpForward',
      'cursorWordPartRightSelect',
      'editor.action.smartSelect.expand',
    ])
  },
)
