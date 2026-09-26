import { afterEach, describe } from 'vitest'

import { expect, test as it } from '../../../test/fixtures'

import { eventTargetsTextEntry } from '@/keymap/utils/keyboard-event'

afterEach(() => {
  document.body.replaceChildren()
})

describe('eventTargetsTextEntry', () => {
  it('counts an EditContext host as text entry, so app chords stay out while typing', () => {
    const host = focusedHost()
    Object.defineProperty(host, 'editContext', { configurable: true, value: {} })

    expect(eventTargetsTextEntry(keydownOn(host))).toBe(true)
  })

  it('leaves the focused editor its own input, which the app keymap drives', () => {
    const host = focusedHost()
    Object.defineProperty(host, 'editContext', { configurable: true, value: {} })

    expect(eventTargetsTextEntry(keydownOn(host), host)).toBe(false)
  })

  it('does not count a plain focusable div', () => {
    expect(eventTargetsTextEntry(keydownOn(focusedHost()))).toBe(false)
  })
})

function focusedHost() {
  const host = document.createElement('div')
  host.tabIndex = 0
  document.body.append(host)
  host.focus()
  return host
}

function keydownOn(target: HTMLElement) {
  const event = new KeyboardEvent('keydown', { bubbles: true, key: 'k' })
  target.dispatchEvent(event)
  return event
}
