import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TouchSelectionController } from '../src/editor/touchSelection'

function dispatchTouch(element: HTMLElement, type: string, x = 20, count = 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', {
    value: Array.from({ length: count }, (_, identifier) => ({
      identifier,
      clientX: x,
      clientY: 20,
    })),
  })
  element.dispatchEvent(event)
  return event
}

describe('TouchSelectionController hold scheduling', () => {
  let element: HTMLElement
  let row: HTMLElement
  let controller: TouchSelectionController
  let word = vi.fn(() => ({ start: 6, end: 11 }))

  beforeEach(() => {
    vi.useFakeTimers()
    element = document.createElement('div')
    row = document.createElement('div')
    row.className = 'editor-virtualized-row'
    element.append(row)
    document.body.append(element)
    word = vi.fn(() => ({ start: 6, end: 11 }))
    controller = new TouchSelectionController({
      element,
      positionAt: () => ({ offset: 8, affinity: 'after', displayRow: 0, rowX: 20 }),
      claimPress: vi.fn(() => false),
      begin: vi.fn(),
      tap: vi.fn(),
      word,
      extend: vi.fn(),
    })
    controller.install()
  })

  afterEach(() => {
    controller.dispose()
    element.remove()
    vi.useRealTimers()
  })

  it('selects once at the hold deadline while the finger remains down', () => {
    dispatchTouch(row, 'touchstart')
    vi.advanceTimersByTime(649)
    expect(word).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(word).toHaveBeenCalledOnce()
    dispatchTouch(row, 'touchend', 20, 0)
    vi.advanceTimersByTime(1000)
    expect(word).toHaveBeenCalledOnce()
  })

  it.each(['touchend', 'touchcancel', 'swipe', 'multitouch', 'native', 'dispose'])(
    'cancels pending work on %s',
    (action) => {
      dispatchTouch(row, 'touchstart')
      vi.advanceTimersByTime(300)
      if (action === 'native') controller.acceptNativeSelection()
      if (action === 'dispose') controller.dispose()
      if (action === 'swipe') {
        expect(dispatchTouch(row, 'touchmove', 40).defaultPrevented).toBe(false)
      }
      if (action === 'multitouch') dispatchTouch(row, 'touchstart', 20, 2)
      if (action === 'touchend') dispatchTouch(row, action, 20, 0)
      if (action === 'touchcancel') dispatchTouch(row, action)
      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(1000)
      expect(word).not.toHaveBeenCalled()
    },
  )

  it('starts a fresh deadline when a pending gesture is replaced', () => {
    dispatchTouch(row, 'touchstart')
    vi.advanceTimersByTime(300)
    dispatchTouch(row, 'touchstart')
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(649)
    expect(word).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(word).toHaveBeenCalledOnce()
  })
})
