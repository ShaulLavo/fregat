import { afterEach, expect, it, vi } from 'vitest'
import { createHotkeyRegistry } from '../src'
import type { HotkeyRegistry } from '../src'

let registry: HotkeyRegistry
afterEach(() => {
  registry?.dispose()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
function setup() {
  registry = createHotkeyRegistry()
  return registry
}
function press(target: EventTarget, key: string, init: KeyboardEventInit = {}, type = 'keydown') {
  const event = new KeyboardEvent(type, {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

it('fires on the key and prevents the browser default', () => {
  const callback = vi.fn()
  setup().register('Control+S', callback, { platform: 'linux' })
  const event = press(document, 's', { ctrlKey: true })
  expect(callback).toHaveBeenCalledOnce()
  expect(callback.mock.calls[0]![1]).toMatchObject({ hotkey: 'Mod+S' })
  expect(event.defaultPrevented).toBe(true)
  expect(press(document, 's').defaultPrevented).toBe(false)
})

it('keeps the default when preventDefault is false', () => {
  setup().register('Control+S', vi.fn(), { platform: 'linux', preventDefault: false })
  expect(press(document, 's', { ctrlKey: true }).defaultPrevented).toBe(false)
})

it('runs the newest registration first and passes on when a callback returns false', () => {
  const calls: string[] = []
  const hotkeys = setup()
  hotkeys.register('Control+K', () => void calls.push('old'), { conflictBehavior: 'allow' })
  hotkeys.register('Control+K', () => (calls.push('new'), false), { conflictBehavior: 'allow' })
  press(document, 'k', { ctrlKey: true })
  expect(calls).toEqual(['new', 'old'])
})

it('fires an element-targeted hotkey only for keys inside the element', () => {
  const panel = document.createElement('div')
  const button = document.createElement('button')
  panel.append(button)
  document.body.append(panel)
  const callback = vi.fn()
  setup().register('Control+E', callback, { target: panel })
  press(document.body, 'e', { ctrlKey: true })
  expect(callback).not.toHaveBeenCalled()
  press(button, 'e', { ctrlKey: true })
  expect(callback).toHaveBeenCalledOnce()
})

it('ignores bare keys in text fields and fires Control chords there', () => {
  const input = document.createElement('input')
  document.body.append(input)
  input.focus()
  const bare = vi.fn()
  const chord = vi.fn()
  const hotkeys = setup()
  hotkeys.register('K', bare)
  hotkeys.register('Control+J', chord)
  expect(press(input, 'k').defaultPrevented).toBe(false)
  press(input, 'j', { ctrlKey: true })
  expect(bare).not.toHaveBeenCalled()
  expect(chord).toHaveBeenCalledOnce()
})

it('stops firing while disabled and keeps the registration listed', () => {
  const callback = vi.fn()
  const hotkeys = setup()
  const handle = hotkeys.register('Control+D', callback)
  handle.setOptions({ enabled: false })
  press(document, 'd', { ctrlKey: true })
  expect(callback).not.toHaveBeenCalled()
  expect(hotkeys.registrations.state.has(handle.id)).toBe(true)
  handle.setOptions({ enabled: true })
  press(document, 'd', { ctrlKey: true })
  expect(callback).toHaveBeenCalledOnce()
})

it('uses the swapped callback without registering again', () => {
  const first = vi.fn()
  const second = vi.fn()
  const handle = setup().register('Control+F', first)
  handle.callback = second
  press(document, 'f', { ctrlKey: true })
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledOnce()
})

it('handles conflicts by warning, throwing or replacing', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const hotkeys = setup()
  const first = vi.fn()
  const replacement = vi.fn()
  const original = hotkeys.register('Control+G', first)
  hotkeys.register('Control+G', vi.fn())
  expect(warn).toHaveBeenCalledOnce()
  expect(() => hotkeys.register('Control+G', vi.fn(), { conflictBehavior: 'error' })).toThrow()
  hotkeys.register('Control+G', replacement, { conflictBehavior: 'replace' })
  expect(original.isActive).toBe(false)
  press(document, 'g', { ctrlKey: true })
  expect(first).not.toHaveBeenCalled()
  expect(replacement).toHaveBeenCalledOnce()
})

it('registers a sequence as a chord whose prefix does not reach the page', () => {
  const callback = vi.fn()
  setup().register(['Control+K', 'Control+C'], callback)
  const prefix = press(document, 'k', { ctrlKey: true })
  expect(prefix.defaultPrevented).toBe(true)
  press(document, 'c', { ctrlKey: true })
  expect(callback).toHaveBeenCalledOnce()
})

it('fires keyup registrations on release', () => {
  const callback = vi.fn()
  setup().register('Escape', callback, { eventType: 'keyup' })
  press(document, 'Escape')
  expect(callback).not.toHaveBeenCalled()
  press(document, 'Escape', {}, 'keyup')
  expect(callback).toHaveBeenCalledOnce()
})

it('fires once per press with requireReset', () => {
  const callback = vi.fn()
  setup().register('Control+R', callback, { requireReset: true })
  press(document, 'r', { ctrlKey: true })
  press(document, 'r', { ctrlKey: true, repeat: true })
  expect(callback).toHaveBeenCalledOnce()
  press(document, 'r', {}, 'keyup')
  press(document, 'r', { ctrlKey: true })
  expect(callback).toHaveBeenCalledTimes(2)
})

it('stops firing after unregister and counts triggers in the view', () => {
  const callback = vi.fn()
  const hotkeys = setup()
  const handle = hotkeys.register('Control+U', callback)
  press(document, 'u', { ctrlKey: true })
  expect(hotkeys.registrations.state.get(handle.id)?.triggerCount).toBe(1)
  handle.unregister()
  press(document, 'u', { ctrlKey: true })
  expect(callback).toHaveBeenCalledOnce()
  expect(hotkeys.registrations.state.size).toBe(0)
})

it('builds the keymap once for many registrations', () => {
  const hotkeys = setup()
  const setKeymap = vi.spyOn(hotkeys.dispatcher, 'setKeymap')
  for (let index = 0; index < 200; index += 1)
    hotkeys.register(`Control+Shift+F${(index % 12) + 1}` as 'Control+Shift+F1', vi.fn(), {
      conflictBehavior: 'allow',
    })
  press(document, 'x')
  press(document, 'y')
  expect(setKeymap).toHaveBeenCalledOnce()
})

it('leaves typed text to a field when the only chord ignores inputs', () => {
  vi.useFakeTimers()
  const callback = vi.fn()
  setup().register(['G', 'G'], callback)
  const input = document.createElement('input')
  document.body.append(input)
  input.focus()
  const typed = ['e', 'g', 'g'].map((key) => press(input, key))
  vi.advanceTimersByTime(1500)
  expect(typed.map((event) => event.defaultPrevented)).toEqual([false, false, false])
  expect(callback).not.toHaveBeenCalled()
  vi.useRealTimers()
})

it('does not claim an element-scoped chord prefix outside the element', () => {
  const inside = document.createElement('div')
  const outside = document.createElement('div')
  outside.tabIndex = 0
  document.body.append(inside, outside)
  setup().register(['Control+K', 'Control+C'], vi.fn(), { target: inside })
  expect(press(outside, 'k', { ctrlKey: true }).defaultPrevented).toBe(false)
  expect(press(inside, 'k', { ctrlKey: true }).defaultPrevented).toBe(true)
})

it('types a chord prefix into the field when no continuation follows', () => {
  vi.useFakeTimers()
  setup().register(['G', 'G'], vi.fn(), { ignoreInputs: false })
  const input = document.createElement('input')
  document.body.append(input)
  input.focus()
  expect(press(input, 'g').defaultPrevented).toBe(true)
  vi.advanceTimersByTime(1000)
  expect(input.value).toBe('g')
  vi.useRealTimers()
})
