import { detectPlatform } from '@fregat/hotkeys'
import { act, renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import { expect, test } from '../../../test/fixtures'
import { binding } from '../../../test/factories/key-binding'
import { createTestCommandRuntime } from '../../../test/factories/command-runtime'
import { createTestQueryClient } from '../../../test/render'
import { FocusService } from '@/lib/focus/state/service'
import { useAppKeymap } from '@/keymap/use-app-keymap'

function press(target: EventTarget, key: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}
function mod(): KeyboardEventInit {
  return detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }
}
function mount(keys = 'Mod+K Mod+S', boundPrefix = false) {
  const calls: boolean[] = []
  const focus = new FocusService()
  const runtime = createTestCommandRuntime({
    focus,
    queryClient: createTestQueryClient(),
    options: {
      runtime: {
        settings: {
          setWallpaperEnabled: (value) => {
            calls.push(value)
            return { kind: 'noop' }
          },
        },
      },
    },
  })
  const bindings = (
    boundPrefix
      ? [binding('Mod+K', { command: 'workspace.toggleWallpaper', platform: detectPlatform() })]
      : []
  ).concat([binding(keys, { command: 'workspace.toggleWallpaper', platform: detectPlatform() })])
  const hook = renderHook(() => useAppKeymap({ bindings, bus: runtime.bus, focus }))
  return { ...hook, calls, focus }
}

test.each(['pointer', 'blur'])('%s cancels the window pending chord', (reason) => {
  const view = mount()
  try {
    press(document.body, 'k', mod())
    expect(view.result.current.pendingChord).not.toBeNull()
    act(() => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'))
      else document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(view.result.current.pendingChord).toBeNull()
    expect(view.calls).toEqual([])
  } finally {
    view.unmount()
  }
})

test.each([false, true])('only a bound prefix expires (bound=%s)', (boundPrefix) => {
  vi.useFakeTimers()
  const view = mount('Mod+K Mod+S', boundPrefix)
  try {
    press(document.body, 'k', mod())
    act(() => vi.advanceTimersByTime(30_000))
    if (boundPrefix) {
      expect(view.result.current.pendingChord).toBeNull()
      expect(view.calls).toEqual([false])
      return
    }
    expect(view.result.current.pendingChord).not.toBeNull()
    expect(view.calls).toEqual([])
    press(document.body, 's', mod())
    expect(view.calls).toEqual([false])
    expect(view.result.current.pendingChord).toBeNull()
  } finally {
    view.unmount()
    vi.useRealTimers()
  }
})

test('one window dispatcher claims a chord and dispatches the real bus once', () => {
  const view = mount()
  expect(press(document.body, 'k', mod()).defaultPrevented).toBe(true)
  expect(view.result.current.pendingChord).not.toBeNull()
  expect(press(document.body, 's', mod()).defaultPrevented).toBe(true)
  expect(view.calls).toEqual([false])
  expect(view.result.current.pendingChord).toBeNull()
  view.unmount()
  expect(press(document.body, 's', mod()).defaultPrevented).toBe(false)
})

test('focus changes cancel a pending chord synchronously', () => {
  const view = mount()
  const first = document.createElement('input')
  const second = document.createElement('input')
  document.body.append(first, second)
  const registrations = [first, second].map((element, index) =>
    view.focus.register({
      area: 'settings',
      element,
      id: { kind: 'settings-page', tabId: String(index) },
      onIntent: () => false,
    }),
  )
  document.addEventListener('focusin', view.focus.handleFocusIn, true)
  act(() => {
    first.focus()
  })
  press(first, 'k', mod())
  act(() => {
    second.focus()
  })
  expect(view.result.current.pendingChord).toBeNull()
  expect(press(second, 's', mod()).defaultPrevented).toBe(false)
  expect(view.calls).toEqual([])
  registrations.forEach((registration) => registration.unregister())
  document.removeEventListener('focusin', view.focus.handleFocusIn, true)
  first.remove()
  second.remove()
  view.unmount()
})

test.each(['x', 'ArrowLeft', 'Shift+F1', 'Alt+F1', 'F13'])(
  '%s yields to native text entry',
  (keys) => {
    const view = mount(keys)
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    const [modifier, key] = keys.includes('+') ? keys.split('+') : ['', keys]
    expect(
      press(input, key!, { shiftKey: modifier === 'Shift', altKey: modifier === 'Alt' })
        .defaultPrevented,
    ).toBe(false)
    expect(view.calls).toEqual([])
    input.remove()
    view.unmount()
  },
)

test.each(Array.from({ length: 12 }, (_, index) => `F${index + 1}`))(
  '%s works from text entry',
  (key) => {
    const view = mount(key)
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    expect(press(input, key).defaultPrevented).toBe(true)
    expect(view.calls).toEqual([false])
    input.remove()
    view.unmount()
  },
)

test('Alt with a keypad digit types an Alt code; Alt with a top-row digit runs the binding', () => {
  const view = mount('Alt+2')
  const altDigit = (code: string) => {
    const event = new KeyboardEvent('keydown', {
      altKey: true,
      bubbles: true,
      cancelable: true,
      code,
      key: '2',
    })
    // happy-dom reports AltGraph for any Alt press; a real browser reports it only for AltGr.
    Object.defineProperty(event, 'getModifierState', { value: (key: string) => key === 'Alt' })
    act(() => {
      document.body.dispatchEvent(event)
    })
    return event
  }
  expect(altDigit('Numpad2').defaultPrevented).toBe(false)
  expect(view.calls).toEqual([])
  expect(altDigit('Digit2').defaultPrevented).toBe(true)
  expect(view.calls).toEqual([false])
  view.unmount()
})
