import { afterEach, expect, test, vi } from 'vitest'
import { createBrowserDispatcher } from '../../src'
import type { BrowserDispatcher } from '../../src'

let dispatcher: BrowserDispatcher | undefined
afterEach(() => {
  dispatcher?.dispose()
  dispatcher = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(document, 'execCommand')
  vi.useRealTimers()
})

function key(target: Element, value: string) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    code: `Key${value.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  target.dispatchEvent(event)
  return event
}

test('an EditContext prefix times out through its cancellable typed-text owner', () => {
  vi.useFakeTimers()
  const host = document.createElement('div')
  host.tabIndex = 0
  const context = { text: 'original', updateText: vi.fn() }
  Object.defineProperty(host, 'editContext', { value: context })
  document.body.append(host)
  host.focus()
  const received: InputEvent[] = []
  host.addEventListener('beforeinput', (event) => {
    received.push(event as InputEvent)
    event.preventDefault()
  })
  const execCommand = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    timeoutMs: 30,
    keymap: [{ keys: 'g g', command: 'select', context: 'Editor' }],
  })
  dispatcher.attachElement(dispatcher.createNode({ context: 'Editor' }), host)
  expect(key(host, 'g').defaultPrevented).toBe(true)
  expect(received).toEqual([])
  vi.advanceTimersByTime(30)
  expect(received).toHaveLength(1)
  expect(received[0]).toMatchObject({
    type: 'beforeinput',
    inputType: 'insertText',
    data: 'g',
    bubbles: true,
    cancelable: true,
    defaultPrevented: true,
  })
  expect(dispatcher.pending()).toBeNull()
  expect(execCommand).not.toHaveBeenCalled()
  expect(context.updateText).not.toHaveBeenCalled()
  expect(context.text).toBe('original')
})

test('an EditContext mismatch replays the prefix and leaves the current stroke to input', () => {
  const host = document.createElement('div')
  Object.defineProperty(host, 'editContext', { value: {} })
  document.body.append(host)
  const received: string[] = []
  host.addEventListener('beforeinput', (event) => {
    received.push((event as InputEvent).data!)
    event.preventDefault()
  })
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    keymap: [{ keys: 'g g', command: 'select', context: 'Editor' }],
  })
  dispatcher.attachElement(dispatcher.createNode({ context: 'Editor' }), host)
  expect(key(host, 'g').defaultPrevented).toBe(true)
  expect(key(host, 'x').defaultPrevented).toBe(false)
  expect(received).toEqual(['g'])
  expect(dispatcher.pending()).toBeNull()
})

test('a null EditContext leaves a plain div chord untimed', () => {
  vi.useFakeTimers()
  const host = document.createElement('div')
  Object.defineProperty(host, 'editContext', { value: null })
  document.body.append(host)
  const received = vi.fn()
  host.addEventListener('beforeinput', received)
  dispatcher = createBrowserDispatcher({
    platform: 'linux',
    timeoutMs: 30,
    keymap: [{ keys: 'g g', command: 'select' }],
  })
  expect(key(host, 'g').defaultPrevented).toBe(true)
  vi.advanceTimersByTime(30)
  expect(dispatcher.pending()).toEqual({ keys: 'G', candidateCount: 1 })
  expect(received).not.toHaveBeenCalled()
})
