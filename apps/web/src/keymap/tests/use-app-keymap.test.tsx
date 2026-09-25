import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, renderHook } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

import { useAppKeymap } from '@/keymap/use-app-keymap'
import type { PlatformCommandId } from '@/keymap/types'

import { expect, test } from '../../../test/fixtures'
import { binding } from '../../../test/factories/key-binding'
import { createTestCommandRuntime } from '../../../test/factories/command-runtime'
import { createTestQueryClient } from '../../../test/render'
import { FocusService, type FocusArea, type FocusTargetToken } from '@/lib/focus/state/service'
import { CHORD_TIMEOUT_MS } from '@workspace/client-core/commands/chord'

afterEach(() => vi.useRealTimers())

function pressKey(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

/** `Mod` is Command on macOS and Control everywhere else. */
function modifierKeys() {
  if (detectPlatform() === 'mac') return { metaKey: true }

  return { ctrlKey: true }
}

test('captures consecutive strokes synchronously and dispatches through the real bus once', () => {
  const harness = mountChordRuntime()
  const prefix = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: 'KeyK',
    key: 'k',
    ...modifierKeys(),
  })
  const completion = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: 'KeyS',
    key: 's',
    ...modifierKeys(),
  })
  act(() => {
    document.body.dispatchEvent(prefix)
    document.body.dispatchEvent(completion)
  })
  expect(prefix.defaultPrevented).toBe(true)
  expect(completion.defaultPrevented).toBe(true)
  expect(harness.calls).toEqual([false])
  expect(harness.result.current.pendingChord).toBeNull()
})

test('publishes pending state and consumes unmatched text without its single-key action', () => {
  const harness = mountChordRuntime()
  const input = document.createElement('input')
  input.value = 'keep'
  document.body.append(input)
  input.focus()
  let reachedInput = false
  input.addEventListener('keydown', () => {
    reachedInput = true
  })

  pressKey(input, { code: 'KeyK', key: 'k', ...modifierKeys() })
  expect(harness.result.current.pendingChord).toMatchObject({ keys: 'Mod+K', candidateCount: 1 })
  expect(harness.calls).toEqual([])
  reachedInput = false
  const unmatched = pressKey(input, { code: 'KeyX', key: 'x' })

  expect(unmatched.defaultPrevented).toBe(true)
  expect(reachedInput).toBe(false)
  expect(input.value).toBe('keep')
  expect(harness.result.current.pendingChord).toBeNull()
  expect(harness.calls).toEqual([])
  input.remove()
})

test('clears the indicator on a real scheduled timeout without another keystroke', () => {
  vi.useFakeTimers()
  const harness = mountChordRuntime()
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  act(() => {
    vi.advanceTimersByTime(CHORD_TIMEOUT_MS)
  })
  expect(harness.result.current.pendingChord).toBeNull()

  const late = pressKey(document.body, { code: 'KeyS', key: 's', ...modifierKeys() })
  expect(late.defaultPrevented).toBe(false)
  expect(harness.calls).toEqual([])
})

test('holding the prefix and pressing modifiers do not extend its deadline', () => {
  vi.useFakeTimers()
  const harness = mountChordRuntime()
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  act(() => {
    vi.advanceTimersByTime(CHORD_TIMEOUT_MS - 1)
  })
  const repeat = pressKey(document.body, {
    code: 'KeyK',
    key: 'k',
    repeat: true,
    ...modifierKeys(),
  })
  const modifier = pressKey(document.body, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
  expect(repeat.defaultPrevented).toBe(true)
  expect(modifier.defaultPrevented).toBe(true)
  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(harness.result.current.pendingChord).toBeNull()
})

test('Escape, pointer movement to another control and window blur cancel pending chords', () => {
  const harness = mountChordRuntime()
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  expect(pressKey(document.body, { key: 'Escape' }).defaultPrevented).toBe(true)
  expect(harness.result.current.pendingChord).toBeNull()
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  act(() => {
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  })
  expect(harness.result.current.pendingChord).toBeNull()
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  act(() => {
    window.dispatchEvent(new Event('blur'))
  })
  expect(harness.result.current.pendingChord).toBeNull()
  expect(harness.calls).toEqual([])
})

test('composition preserves an armed chord and does not consume IME keystrokes', () => {
  const harness = mountChordRuntime()
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  const composition = pressKey(document.body, {
    code: 'KeyS',
    key: 's',
    isComposing: true,
    ...modifierKeys(),
  })
  const firstComposition = pressKey(document.body, {
    keyCode: 229,
    code: 'KeyS',
    key: 's',
    ...modifierKeys(),
  })
  expect(composition.defaultPrevented).toBe(false)
  expect(firstComposition.defaultPrevented).toBe(false)
  expect(harness.result.current.pendingChord).not.toBeNull()
  expect(harness.calls).toEqual([])
  pressKey(document.body, { code: 'KeyS', key: 's', ...modifierKeys() })
  expect(harness.calls).toEqual([false])
})

test('changing owner within one pane, changing pane, and unmounting cancel the session', () => {
  const harness = mountChordRuntime()
  const focus = new FocusService()
  const registration = focus.register({
    area: 'editor',
    element: document.body,
    id: { kind: 'editor', surface: 'document', key: 'next' },
    onIntent: () => false,
  })
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  harness.rerender({ focusedPane: 'global', focusedTarget: registration.token })
  expect(harness.result.current.pendingChord).toBeNull()
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  harness.rerender({ focusedPane: 'editor', focusedTarget: registration.token })
  expect(harness.result.current.pendingChord).toBeNull()
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  harness.unmount()
  expect(
    pressKey(document.body, { code: 'KeyS', key: 's', ...modifierKeys() }).defaultPrevented,
  ).toBe(false)
  expect(harness.calls).toEqual([])
  registration.unregister()
})

test('a handoff checks an unavailable command once and lets its key reach the terminal', () => {
  const harness = mountChordRuntime()
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'F2' })
  const dispatch = vi.spyOn(harness.bus, 'dispatch')
  const capture = vi.spyOn(harness.bus, 'capture')
  let claimed = true
  act(() => {
    claimed = harness.result.current.claimKeybinding(event)
    document.body.dispatchEvent(event)
  })
  expect(claimed).toBe(false)
  expect(dispatch).not.toHaveBeenCalled()
  expect(capture).toHaveBeenCalledTimes(1)
  expect(event.defaultPrevented).toBe(false)
})

test('an unavailable chord completion is still swallowed after the prefix committed it', () => {
  const harness = mountChordRuntime('editor.undo')
  const target = {
    area: 'editor' as const,
    id: { kind: 'editor' as const, surface: 'document' as const, key: 'conditional' },
    capabilities: { editor: { dispatch: () => true, writable: true } },
    onIntent: () => false,
  }
  const registration = harness.focus.register({ ...target, element: document.body })
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  expect(harness.result.current.pendingChord).not.toBeNull()
  registration.update({
    ...target,
    capabilities: { editor: { dispatch: () => true, writable: false } },
  })
  const completion = pressKey(document.body, { code: 'KeyS', key: 's', ...modifierKeys() })
  expect(completion.defaultPrevented).toBe(true)
  expect(harness.result.current.pendingChord).toBeNull()
  expect(harness.calls).toEqual([])
  registration.unregister()
})

function mountChordRuntime(
  command: PlatformCommandId = 'workspace.toggleWallpaper',
  keys = 'Mod+K Mod+S',
) {
  const calls: boolean[] = []
  const focus = new FocusService()
  const runtime = createTestCommandRuntime({
    focus,
    options: {
      runtime: {
        settings: {
          setWallpaperEnabled: (enabled) => {
            calls.push(enabled)
            return { kind: 'noop' }
          },
        },
      },
    },
    queryClient: createTestQueryClient(),
  })
  const bindings = [
    binding(keys, { command, platform: detectPlatform() }),
    binding('F2', { command: 'workspace.focusEditor', platform: detectPlatform() }),
  ]
  const props: { focusedPane: FocusArea; focusedTarget: FocusTargetToken | null } = {
    focusedPane: 'global',
    focusedTarget: null,
  }
  const hook = renderHook(
    (options: typeof props) => useAppKeymap({ bindings, bus: runtime.bus, focus, ...options }),
    { initialProps: props },
  )
  return { ...hook, bus: runtime.bus, calls, focus }
}

test('a focus change cancels before React can commit the next owner', () => {
  const harness = mountChordRuntime()
  const first = document.createElement('input')
  const second = document.createElement('input')
  document.body.append(first, second)
  const registrations = [first, second].map((element, index) =>
    harness.focus.register({
      area: 'editor',
      element,
      id: { kind: 'editor', key: `focus-${index}`, surface: 'document' },
      onIntent: () => false,
    }),
  )
  document.addEventListener('focusin', harness.focus.handleFocusIn, true)
  try {
    act(() => {
      first.focus()
    })
    pressKey(first, { code: 'KeyK', key: 'k', ...modifierKeys() })
    const completion = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyS',
      key: 's',
      ...modifierKeys(),
    })
    act(() => {
      second.focus()
      second.dispatchEvent(completion)
    })
    expect(harness.calls).toEqual([])
    expect(harness.result.current.pendingChord).toBeNull()
    expect(completion.defaultPrevented).toBe(false)
  } finally {
    document.removeEventListener('focusin', harness.focus.handleFocusIn, true)
    registrations.forEach((registration) => registration.unregister())
    first.remove()
    second.remove()
  }
})

test('a held prefix remains consumed after timeout until its matching release', () => {
  vi.useFakeTimers()
  const harness = mountChordRuntime()
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  act(() => {
    vi.advanceTimersByTime(CHORD_TIMEOUT_MS)
  })
  expect(harness.result.current.pendingChord).toBeNull()
  const repeat = pressKey(document.body, {
    code: 'KeyK',
    key: 'k',
    repeat: true,
    ...modifierKeys(),
  })
  expect(repeat.defaultPrevented).toBe(true)
  const release = new KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    code: 'KeyK',
    key: 'k',
    ...modifierKeys(),
  })
  act(() => {
    document.body.dispatchEvent(release)
  })
  expect(release.defaultPrevented).toBe(true)
  const freshRepeat = pressKey(document.body, {
    code: 'KeyK',
    key: 'k',
    repeat: true,
    ...modifierKeys(),
  })
  expect(freshRepeat.defaultPrevented).toBe(false)
})

test('holding a chord completion does not dispatch its standalone binding', () => {
  const harness = mountChordRuntime('workspace.toggleWallpaper', 'Mod+K F2')
  const dispatch = vi.spyOn(harness.bus, 'dispatch')
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  pressKey(document.body, { code: 'F2', key: 'F2' })
  harness.rerender({ focusedPane: 'terminal', focusedTarget: null })
  pressKey(document.body, { code: 'F2', key: 'F2', repeat: true })

  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(harness.calls).toEqual([false])

  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keyup', { bubbles: true, code: 'F2', key: 'F2' }),
    )
  })
  pressKey(document.body, { code: 'F2', key: 'F2' })
  pressKey(document.body, { code: 'F2', key: 'F2', repeat: true })
  expect(dispatch).toHaveBeenCalledTimes(1)
})

test('single-stroke commands still dispatch on repeat', () => {
  const harness = mountChordRuntime('workspace.toggleWallpaper', 'F3')
  pressKey(document.body, { code: 'F3', key: 'F3' })
  pressKey(document.body, { code: 'F3', key: 'F3', repeat: true })

  expect(harness.calls).toEqual([false, false])
})

test('changing document identity or native input under one focus token cancels synchronously', () => {
  const harness = mountChordRuntime()
  const first = document.createElement('input')
  const second = document.createElement('input')
  const host = document.createElement('section')
  host.append(first, second)
  document.body.append(host)
  let input = first
  const target = {
    area: 'editor' as const,
    id: { kind: 'editor' as const, key: 'before', surface: 'document' as const },
    capabilities: {
      editor: { writable: true, dispatch: () => false, getInputElement: () => input },
    },
    onIntent: () => false,
  }
  const registration = harness.focus.register({ ...target, element: host })
  document.addEventListener('focusin', harness.focus.handleFocusIn, true)
  act(() => first.focus())
  pressKey(first, { key: 'k', code: 'KeyK', ...modifierKeys() })
  expect(harness.result.current.pendingChord).not.toBeNull()
  act(() => registration.update({ ...target, id: { ...target.id, key: 'after' } }))
  expect(harness.result.current.pendingChord).toBeNull()

  pressKey(first, { key: 'k', code: 'KeyK', ...modifierKeys() })
  expect(harness.result.current.pendingChord).not.toBeNull()
  input = second
  act(() => registration.update({ ...target, id: { ...target.id, key: 'after' } }))
  expect(harness.result.current.pendingChord).toBeNull()
  registration.unregister()
  document.removeEventListener('focusin', harness.focus.handleFocusIn, true)
  host.remove()
})

test.each(['x', 'y'])('a held chord stroke %s stays above descendant key handlers', (key) => {
  const harness = mountChordRuntime('workspace.toggleWallpaper', 'Mod+K X')
  const target = document.createElement('div')
  document.body.append(target)
  let inserted = ''
  target.addEventListener('keydown', (event) => {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey) return

    inserted += event.key
    event.stopPropagation()
  })
  try {
    pressKey(target, { code: 'KeyK', key: 'k', ...modifierKeys() })
    const code = `Key${key.toUpperCase()}`
    pressKey(target, { code, key })
    const repeat = pressKey(target, { code, key, repeat: true })

    expect(inserted).toBe('')
    expect(repeat.defaultPrevented).toBe(true)
    expect(harness.result.current.pendingChord).toBeNull()

    act(() => {
      target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, code, key }))
    })
    pressKey(target, { code, key })
    expect(inserted).toBe(key)
  } finally {
    target.remove()
  }
})

test('hiding the document cancels the pending chord', () => {
  const harness = mountChordRuntime()
  pressKey(document.body, { code: 'KeyK', key: 'k', ...modifierKeys() })
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(harness.result.current.pendingChord).toBeNull()
  visibility.mockRestore()
})

test('leaves AltGraph character entry unclaimed even when its physical key matches a shortcut', () => {
  const harness = mountChordRuntime('workspace.toggleWallpaper', 'Ctrl+Alt+2')
  const input = document.createElement('input')
  document.body.append(input)
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    altKey: true,
    code: 'Digit2',
    key: '²',
  })
  Object.defineProperty(event, 'getModifierState', { value: (key: string) => key === 'AltGraph' })
  act(() => {
    input.dispatchEvent(event)
  })
  expect(event.defaultPrevented).toBe(false)
  expect(harness.calls).toEqual([])
  input.remove()
})

test.each([
  ['workspace.fixDiagnostic', 'fixDiagnostic'],
  ['workspace.toggleCheckpointChange', 'toggleCheckpointChange'],
] as const)(
  'dispatches the rebound %s action to its registered target with exact modifiers',
  (command, capability) => {
    const harness = mountChordRuntime(command, 'Ctrl+U')
    const element = document.createElement('div')
    document.body.append(element)
    let calls = 0
    const registration = harness.focus.register({
      area: 'problems',
      id: { kind: 'problems' },
      element,
      capabilities: {
        [capability]: () => {
          calls++
          return true
        },
      },
      onIntent: () => false,
    })
    expect(pressKey(element, { key: 'u', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(
      false,
    )
    expect(calls).toBe(0)
    expect(pressKey(element, { key: 'u', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(calls).toBe(1)
    registration.unregister()
    element.remove()
  },
)

test.each([
  ['Ctrl+Alt+2', '2', 'Digit2'],
  ['Ctrl+Alt+B', 'b', 'KeyB'],
  ['Ctrl+Alt+ArrowRight', 'ArrowRight', 'ArrowRight'],
] as const)('keeps a logical AltGraph shortcut available: %s', (binding, key, code) => {
  const harness = mountChordRuntime('workspace.toggleWallpaper', binding)
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    altKey: true,
    key,
    code,
  })
  Object.defineProperty(event, 'getModifierState', {
    value: (modifier: string) => modifier === 'AltGraph',
  })
  act(() => {
    document.body.dispatchEvent(event)
  })
  expect(event.defaultPrevented).toBe(true)
  expect(harness.calls).toEqual([false])
})

test.each([
  ['Ctrl+Alt+]', ']', 'Digit9'],
  ['Ctrl+Alt+[', '[', 'Digit8'],
] as const)('leaves a character AltGraph typed to the text control: %s', (binding, key, code) => {
  const harness = mountChordRuntime('workspace.toggleWallpaper', binding)
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    altKey: true,
    key,
    code,
  })
  Object.defineProperty(event, 'getModifierState', {
    value: (modifier: string) => modifier === 'AltGraph',
  })
  act(() => {
    document.body.dispatchEvent(event)
  })
  expect(event.defaultPrevented).toBe(false)
  expect(harness.calls).toEqual([])
})
