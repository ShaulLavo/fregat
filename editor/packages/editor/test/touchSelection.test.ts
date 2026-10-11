import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TouchSelectionController } from '../src/editor/touchSelection'

function dispatchTouch(element: HTMLElement, type: string, x = 20, count = 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'timeStamp', { value: Date.now() })
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
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'Date',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    })
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
      scroll: vi.fn(() => false),
      focus: vi.fn(),
      menuAnchor: () => null,
      menuItems: () => [],
    })
    controller.install()
  })

  afterEach(() => {
    controller.dispose()
    element.remove()
    vi.useRealTimers()
  })

  it('suppresses native row selection before host touch callbacks and restores it on release', () => {
    const seen: string[] = []
    row.addEventListener('touchstart', () => seen.push(element.dataset.editorTouchSelecting ?? ''))
    dispatchTouch(row, 'touchstart')
    expect(seen).toEqual(['true'])
    expect(element.dataset.editorTouchSelecting).toBe('true')
    vi.advanceTimersByTime(550)
    dispatchTouch(row, 'touchend', 20, 0)
    expect(element.hasAttribute('data-editor-touch-selecting')).toBe(false)
  })

  it('selects once at the hold deadline while the finger remains down', () => {
    dispatchTouch(row, 'touchstart')
    vi.advanceTimersByTime(549)
    expect(word).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(word).toHaveBeenCalledOnce()
    dispatchTouch(row, 'touchend', 20, 0)
    vi.advanceTimersByTime(1000)
    expect(word).toHaveBeenCalledOnce()
  })

  it.each(['touchend', 'touchcancel', 'swipe', 'multitouch', 'dispose'])(
    'cancels pending work on %s',
    (action) => {
      dispatchTouch(row, 'touchstart')
      vi.advanceTimersByTime(300)
      if (action === 'dispose') controller.dispose()
      if (action === 'swipe') {
        expect(dispatchTouch(row, 'touchmove', 40).defaultPrevented).toBe(false)
      }
      if (action === 'multitouch') dispatchTouch(row, 'touchstart', 20, 2)
      if (action === 'touchend') dispatchTouch(row, action, 20, 0)
      if (action === 'touchcancel') dispatchTouch(row, action)
      expect(element.hasAttribute('data-editor-touch-selecting')).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(1000)
      expect(word).not.toHaveBeenCalled()
    },
  )

  it('leaves a stationary tap and a swipe release available to the browser', () => {
    dispatchTouch(row, 'touchstart')
    expect(dispatchTouch(row, 'touchend', 20, 0).defaultPrevented).toBe(false)
    vi.advanceTimersByTime(400)
    dispatchTouch(row, 'touchstart')
    dispatchTouch(row, 'touchmove', 40)
    expect(dispatchTouch(row, 'touchend', 40, 0).defaultPrevented).toBe(false)
  })

  it('claims visible-row native selection while retaining input selection', () => {
    dispatchTouch(row, 'touchstart')
    const selection = new Event('selectstart', { bubbles: true, cancelable: true })
    row.dispatchEvent(selection)
    expect(selection.defaultPrevented).toBe(true)
    const input = document.createElement('textarea')
    element.append(input)
    const typing = new Event('selectstart', { bubbles: true, cancelable: true })
    input.dispatchEvent(typing)
    expect(typing.defaultPrevented).toBe(false)
  })

  it('keeps the menu for the same selection and dismisses a changed selection', () => {
    const session = {},
      snapshot = {},
      selections = {}
    controller.selectionChanged(session, snapshot, selections)
    dispatchTouch(row, 'touchstart')
    vi.advanceTimersByTime(550)
    dispatchTouch(row, 'touchend', 20, 0)
    vi.advanceTimersByTime(16)
    expect(document.querySelector('.editor-touch-menu')).not.toBeNull()
    controller.selectionChanged(session, snapshot, selections)
    expect(document.querySelector('.editor-touch-menu')).not.toBeNull()
    controller.selectionChanged(session, snapshot, {})
    expect(document.querySelector('.editor-touch-menu')).toBeNull()
  })

  it('starts a fresh deadline when a pending gesture is replaced', () => {
    dispatchTouch(row, 'touchstart')
    vi.advanceTimersByTime(300)
    dispatchTouch(row, 'touchstart')
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(549)
    expect(word).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(word).toHaveBeenCalledOnce()
  })
})
