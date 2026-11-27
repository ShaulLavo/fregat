import { eventTargetsTextEntry } from '@/keymap/utils/keyboard-event'
import { expect, test } from '../../../test/fixtures'

test('EditContext hosts count as text entry even when isContentEditable is false', () => {
  const host = document.createElement('div')
  document.body.append(host)
  try {
    expect(host.isContentEditable).toBe(false)
    const plainEvent = new KeyboardEvent('keydown', { key: 'b', bubbles: true })
    Object.defineProperty(plainEvent, 'target', { value: host })
    expect(eventTargetsTextEntry(plainEvent)).toBe(false)

    Object.defineProperty(host, 'editContext', {
      configurable: true,
      value: { text: '' },
    })
    const editContextEvent = new KeyboardEvent('keydown', { key: 'b', bubbles: true })
    Object.defineProperty(editContextEvent, 'target', { value: host })
    expect(eventTargetsTextEntry(editContextEvent)).toBe(true)
    expect(eventTargetsTextEntry(editContextEvent, host)).toBe(false)
  } finally {
    host.remove()
  }
})
