import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installLongPressContextMenu } from '@/keymap/menus/state/long-press'

// In the dom project, which runs *.test.tsx files: the dispatcher needs a window.
let uninstall: () => void
let row: HTMLDivElement
const opened = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  row = document.createElement('div')
  row.textContent = 'Review the release notes'
  row.style.userSelect = 'none'
  document.body.append(row)
  row.addEventListener('contextmenu', (event) => opened(event.clientX, event.clientY))
  uninstall = installLongPressContextMenu(window)
})

afterEach(() => {
  uninstall()
  row.remove()
  opened.mockReset()
  window.getSelection()?.removeAllRanges()
  vi.useRealTimers()
})

function touch(type: string, x: number, y: number, touches = 1) {
  const point = { clientX: x, clientY: y, target: row }
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { touches: touches ? Array.from({ length: touches }, () => point) : [] })
  row.dispatchEvent(event)
  return event
}

test('a held touch opens the context menu at the press point', () => {
  touch('touchstart', 40, 60)
  vi.advanceTimersByTime(600)
  expect(opened).toHaveBeenCalledWith(40, 60)
})

test('a tap, a drag or a second finger opens nothing', () => {
  touch('touchstart', 40, 60)
  touch('touchend', 40, 60, 0)
  touch('touchstart', 40, 60)
  touch('touchmove', 40, 90)
  touch('touchstart', 40, 60, 2)
  vi.advanceTimersByTime(600)
  expect(opened).not.toHaveBeenCalled()
})

test('a scroll during the hold opens nothing', () => {
  touch('touchstart', 40, 60)
  window.dispatchEvent(new Event('scroll'))
  vi.advanceTimersByTime(600)
  expect(opened).not.toHaveBeenCalled()
})

test('lifting after a long hold that opened the menu cancels the lift, so nothing under it is pressed', () => {
  touch('touchstart', 40, 60)
  vi.advanceTimersByTime(1_600)
  expect(opened).toHaveBeenCalledOnce()

  expect(touch('touchend', 40, 60, 0).defaultPrevented).toBe(true)
  // The next tap is an ordinary tap.
  touch('touchstart', 40, 60)
  expect(touch('touchend', 40, 60, 0).defaultPrevented).toBe(false)
})

test('a selection made during the hold leaves the platform its text selection', () => {
  touch('touchstart', 40, 60)
  const range = document.createRange()
  range.selectNodeContents(row)
  window.getSelection()?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  vi.advanceTimersByTime(600)
  expect(opened).not.toHaveBeenCalled()
})

test('a press that starts on selectable text is the platform’s', () => {
  row.style.userSelect = 'text'
  const text = row.firstChild!
  Object.assign(document, {
    caretRangeFromPoint: () => ({ startContainer: text }),
  })
  touch('touchstart', 40, 60)
  vi.advanceTimersByTime(600)
  Reflect.deleteProperty(document, 'caretRangeFromPoint')
  expect(opened).not.toHaveBeenCalled()
})

test('a platform that fires its own long-press menu is left alone from then on', () => {
  touch('touchstart', 40, 60)
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 }))
  vi.advanceTimersByTime(600)
  touch('touchend', 40, 60, 0)
  touch('touchstart', 10, 10)
  vi.advanceTimersByTime(600)
  expect(opened).toHaveBeenCalledOnce()
})

test('a platform whose menu comes on the lift, after this one opened, gets no second menu', () => {
  touch('touchstart', 40, 60)
  vi.advanceTimersByTime(1_200)
  touch('touchend', 40, 60, 0)
  row.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }),
  )
  expect(opened).toHaveBeenCalledOnce()

  touch('touchstart', 10, 10)
  vi.advanceTimersByTime(600)
  expect(opened).toHaveBeenCalledOnce()
})
