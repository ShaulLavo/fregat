import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installLongPressContextMenu } from '@/keymap/menus/state/long-press'

let uninstall: () => void
let row: HTMLDivElement
const opened = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  row = document.createElement('div')
  document.body.append(row)
  row.addEventListener('contextmenu', (event) => opened(event.clientX, event.clientY))
  uninstall = installLongPressContextMenu(window)
})

afterEach(() => {
  uninstall()
  row.remove()
  opened.mockReset()
  vi.useRealTimers()
})

function touch(type: string, x: number, y: number, touches = 1) {
  const point = { clientX: x, clientY: y, target: row }
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { touches: touches ? Array.from({ length: touches }, () => point) : [] })
  row.dispatchEvent(event)
}

test('a held touch opens the context menu at the press point', () => {
  touch('touchstart', 40, 60)
  vi.advanceTimersByTime(600)
  expect(opened).toHaveBeenCalledWith(40, 60)
})

test('a tap, a scroll or a second finger opens nothing', () => {
  touch('touchstart', 40, 60)
  touch('touchend', 40, 60, 0)
  touch('touchstart', 40, 60)
  touch('touchmove', 40, 90)
  touch('touchstart', 40, 60, 2)
  vi.advanceTimersByTime(600)
  expect(opened).not.toHaveBeenCalled()
})

test('a platform that fires its own long-press menu is left alone from then on', () => {
  touch('touchstart', 40, 60)
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 }))
  vi.advanceTimersByTime(600)
  touch('touchstart', 10, 10)
  vi.advanceTimersByTime(600)
  expect(opened).toHaveBeenCalledTimes(1)
})
