import { afterEach, expect, test, vi } from 'vitest'
import { createKeymapRuntime } from '../../src'
import type { KeymapBinding, KeymapRuntime, KeymapSequenceEvent } from '../../src'

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
  vi.restoreAllMocks()
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
// Zed: an unavailable binding is no binding, so the continuation mismatches and runs fresh.
test('availability is fresh at continuation and an unavailable completion runs fresh', () => {
  const h = setup()
  expect(h.claim(key('k', { ctrlKey: true }))).toBe(true)
  h.setAvailable(false)
  const continuation = key('c', { ctrlKey: true })
  expect(h.claim(continuation)).toBe(false)
  expect(continuation.defaultPrevented).toBe(false)
  expect(h.calls).toEqual([])
  expect(h.events[0]?.outcome).toBe('unmatched')
  expect(h.captures()).toBe(3)
})
test('a bound prefix waits for its chord and runs its candidates in order on timeout', () => {
  vi.useFakeTimers()
  const table: readonly KeymapBinding<string>[] = Array.of<KeymapBinding<string>>(
    { chord: ['Control+K'], payload: 'tab' },
    { chord: ['Control+K'], payload: 'single' },
  ).concat(bindings)
  const h = setup(table)
  expect(h.claim(key('k', { ctrlKey: true }))).toBe(true)
  expect(h.calls).toEqual([])
  vi.advanceTimersByTime(1000)
  expect(h.calls).toEqual(['tab', 'single'])
  expect(h.events.map((event) => [event.outcome, event.binding?.payload])).toEqual([
    ['timeout', 'single'],
  ])
})
test('a bound prefix followed by its continuation runs only the chord', () => {
  vi.useFakeTimers()
  const h = setup(
    Array.of<KeymapBinding<string>>({ chord: ['Control+K'], payload: 'single' }).concat(bindings),
  )
  h.claim(key('k', { ctrlKey: true }))
  h.claim(key('c', { ctrlKey: true }))
  vi.advanceTimersByTime(5000)
  expect(h.calls).toEqual(['comment'])
})
test('ineligible singles preserve deeper prefixes; deeper sequences execute', () => {
  const calls: string[] = []
  runtime = createKeymapRuntime({
    root: document,
    bindings: Array.of<KeymapBinding<string>>({ chord: ['Control+K'], payload: 'single' }).concat(
      bindings,
    ),
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
test('an unbound prefix waits for the next key without a timeout', () => {
  vi.useFakeTimers()
  const h = setup()
  h.claim(key('k', { ctrlKey: true }))
  vi.advanceTimersByTime(60_000)
  h.claim(key('c', { ctrlKey: true }))
  expect(h.calls).toEqual(['comment'])
})
test('a scheduled timeout does not depend on another event and repeats do not extend it', () => {
  vi.useFakeTimers()
  const h = setup(
    Array.of<KeymapBinding<string>>({ chord: ['Control+K'], payload: 'single' }).concat(bindings),
  )
  h.claim(key('k', { ctrlKey: true }))
  vi.advanceTimersByTime(900)
  h.claim(key('k', { ctrlKey: true, repeat: true }))
  vi.advanceTimersByTime(100)
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

test('a declined prefix binding hands the prefix to replay on timeout', () => {
  vi.useFakeTimers()
  const replayed: string[] = []
  runtime = createKeymapRuntime({
    root: document,
    platform: 'linux',
    bindings: Array.of<KeymapBinding<string>>({ chord: ['Control+K'], payload: 'tab' }).concat(
      bindings,
    ),
    captureContext: () => null,
    isAvailable: () => true,
    dispatch: ({ payload }) => payload !== 'tab',
    replay: (input) => replayed.push(input.key),
  })
  expect(runtime.claimKeybinding(key('k', { ctrlKey: true }))).toBe(true)
  vi.advanceTimersByTime(1000)
  expect(replayed).toEqual(['K'])
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

// From the Editor's browser chord suite, driven with synthetic events.
test('held prefix and completion stay owned until release; a mismatch runs fresh', () => {
  const h = setup()
  expect(h.claim(key('k', { ctrlKey: true }))).toBe(true)
  expect(h.claim(key('k', { ctrlKey: true, repeat: true }))).toBe(true)
  expect(h.claim(key('c', { ctrlKey: true }))).toBe(true)
  expect(h.claim(key('c', { ctrlKey: true, repeat: true }))).toBe(true)
  expect(h.calls).toEqual(['comment'])
  expect(h.claim(key('c', {}, 'keyup'))).toBe(true)
  expect(h.claim(key('k', {}, 'keyup'))).toBe(true)
  expect(h.claim(key('k', { ctrlKey: true }))).toBe(true)
  const mismatch = key('x')
  expect(h.claim(mismatch)).toBe(false)
  expect(mismatch.defaultPrevented).toBe(false)
  expect(h.claim(key('x', { repeat: true }))).toBe(false)
  expect(h.events.map((event) => event.outcome)).toEqual(['completed', 'unmatched'])
})
test('binding replacement cancels pending and disposal removes listeners', () => {
  const h = setup()
  h.claim(key('k', { ctrlKey: true }))
  runtime!.updateBindings([{ chord: ['Control+K', 'Control+D'], payload: 'replacement' }])
  expect(h.events[0]?.outcome).toBe('superseded')
  h.claim(key('c', { ctrlKey: true }))
  h.claim(key('k', { ctrlKey: true }))
  h.claim(key('d', { ctrlKey: true }))
  expect(h.calls).toEqual(['replacement'])
  runtime!.dispose()
  const event = key('k', { ctrlKey: true })
  document.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(runtime!.claimKeybinding(key('k', { ctrlKey: true }))).toBe(false)
})

test('a pending chord publishes its label and clears it when it ends', () => {
  const labels: Array<string | null> = []
  runtime = createKeymapRuntime({
    root: document,
    platform: 'linux',
    bindings,
    captureContext: () => null,
    isAvailable: () => true,
    dispatch: () => true,
    onPendingChange: (pending) =>
      labels.push(pending && `${pending.keys}/${pending.candidateCount}`),
  })
  runtime.claimKeybinding(key('k', { ctrlKey: true }))
  runtime.claimKeybinding(key('d', { ctrlKey: true }))
  runtime.claimKeybinding(key('e', { ctrlKey: true }))
  expect(labels).toEqual(['Mod+K/2', 'Mod+K Mod+D/1', null])
})

test('a mismatch replays the buffered keys in order before the new key runs', () => {
  const order: string[] = []
  runtime = createKeymapRuntime({
    root: document,
    platform: 'linux',
    bindings: bindings.concat([{ chord: ['Control+X'], payload: 'cut' }]),
    captureContext: () => null,
    isAvailable: () => true,
    dispatch: ({ payload }) => {
      order.push(payload)
      return true
    },
    replay: (input) => order.push(`replay ${input.key}`),
  })
  runtime.claimKeybinding(key('k', { ctrlKey: true }))
  runtime.claimKeybinding(key('d', { ctrlKey: true }))
  expect(runtime.claimKeybinding(key('x', { ctrlKey: true }))).toBe(true)
  expect(order).toEqual(['replay K', 'replay D', 'cut'])
})

test('a mismatch runs the longest bound prefix and replays the rest', () => {
  const order: string[] = []
  runtime = createKeymapRuntime({
    root: document,
    platform: 'linux',
    bindings: Array.of<KeymapBinding<string>>({
      chord: ['Control+K', 'Control+D'],
      payload: 'kd',
    }).concat(bindings),
    captureContext: () => null,
    isAvailable: () => true,
    dispatch: ({ payload }) => {
      order.push(payload)
      return true
    },
    replay: (input) => order.push(`replay ${input.key}`),
  })
  runtime.claimKeybinding(key('k', { ctrlKey: true }))
  runtime.claimKeybinding(key('d', { ctrlKey: true }))
  runtime.claimKeybinding(key('z', { ctrlKey: true }))
  expect(order).toEqual(['kd'])
})

test('a pending chord belongs to the focus it started under', () => {
  const first = document.createElement('input')
  const second = document.createElement('input')
  document.body.append(first, second)
  const h = setup()
  first.focus()
  h.claim(key('k', { ctrlKey: true }))
  second.focus()
  expect(h.claim(key('c', { ctrlKey: true }))).toBe(false)
  expect(h.calls).toEqual([])
  expect(h.events[0]?.outcome).toBe('superseded')
})
