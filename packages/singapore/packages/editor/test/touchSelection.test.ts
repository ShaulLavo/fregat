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
  let notify = vi.fn()
  let focus = vi.fn()
  let word = vi.fn((_position?: unknown, _granularity?: string) => ({ start: 6, end: 11 }))

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
    notify = vi.fn()
    focus = vi.fn()
    word = vi.fn((_position?: unknown, _granularity?: string) => ({ start: 6, end: 11 }))
    controller = new TouchSelectionController({
      element,
      positionAt: () => ({ offset: 8, affinity: 'after', displayRow: 0, rowX: 20 }),
      claimPress: vi.fn(() => false),
      begin: vi.fn(),
      tap: vi.fn(),
      select: word,
      extend: vi.fn(),
      scroll: vi.fn(() => false),
      focus,
      notify,
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

  it('continues the tap sequence through word, line and document selection', () => {
    for (let tap = 0; tap < 4; tap++) {
      dispatchTouch(row, 'touchstart')
      dispatchTouch(row, 'touchend', 20, 0)
      vi.advanceTimersByTime(100)
    }
    expect(word.mock.calls.map((call) => call[1])).toEqual(['word', 'line', 'document'])
  })

  it.each(['time', 'distance'])(
    'resets the multi-tap sequence after crossing the %s threshold',
    (threshold) => {
      for (let tap = 0; tap < 2; tap++) {
        dispatchTouch(row, 'touchstart')
        dispatchTouch(row, 'touchend', 20, 0)
        vi.advanceTimersByTime(100)
      }
      if (threshold === 'time') vi.advanceTimersByTime(351)
      const x = threshold === 'distance' ? 40 : 20
      dispatchTouch(row, 'touchstart', x)
      dispatchTouch(row, 'touchend', x, 0)
      expect(word).toHaveBeenCalledTimes(1)
      dispatchTouch(row, 'touchstart', x)
      dispatchTouch(row, 'touchend', x, 0)
      expect(word.mock.calls.map((call) => call[1])).toEqual(['word', 'word'])
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

  it('keeps settled state for identical selections and cancels changed selection state', () => {
    const session = {},
      snapshot = {},
      selections = {}
    controller.selectionChanged(session, snapshot, selections)
    dispatchTouch(row, 'touchstart')
    vi.advanceTimersByTime(550)
    dispatchTouch(row, 'touchend', 20, 0)
    vi.advanceTimersByTime(16)
    expect(notify).toHaveBeenLastCalledWith('end', 'word', { x: 20, y: 20, bottom: 36 })
    const calls = notify.mock.calls.length
    controller.selectionChanged(session, snapshot, selections)
    expect(notify).toHaveBeenCalledTimes(calls)
    controller.selectionChanged(session, snapshot, {})
    expect(notify).toHaveBeenLastCalledWith('cancel', null)
  })

  it.each(['holding', 'released', 'settled'])(
    'clears the selection and cancels a %s touch gesture',
    (phase) => {
      const session = {},
        snapshot = {},
        selections = {}
      controller.selectionChanged(session, snapshot, selections)
      dispatchTouch(row, 'touchstart')
      if (phase !== 'holding') {
        vi.advanceTimersByTime(550)
        dispatchTouch(row, 'touchend', 20, 0)
      }
      if (phase === 'settled') vi.advanceTimersByTime(16)

      controller.clearSelection()

      expect(element.hasAttribute('data-editor-touch-selecting')).toBe(false)
      expect(notify).toHaveBeenLastCalledWith('cancel', null)
      const calls = notify.mock.calls.length
      vi.advanceTimersByTime(1000)
      expect(notify).toHaveBeenCalledTimes(calls)
      if (phase === 'holding') expect(word).not.toHaveBeenCalled()

      controller.selectionChanged(session, snapshot, selections)
      expect(notify).toHaveBeenCalledTimes(calls + 1)
    },
  )

  it.each(['session', 'snapshot', 'selection'])(
    'cancels a hold when the %s changes externally',
    (kind) => {
      const session = {},
        snapshot = {},
        selections = {}
      controller.selectionChanged(session, snapshot, selections)
      dispatchTouch(row, 'touchstart')
      vi.advanceTimersByTime(300)
      controller.selectionChanged(
        kind === 'session' ? {} : session,
        kind === 'snapshot' ? {} : snapshot,
        kind === 'selection' ? {} : selections,
      )
      vi.advanceTimersByTime(500)
      expect(word).not.toHaveBeenCalled()
      expect(element.hasAttribute('data-editor-touch-selecting')).toBe(false)
    },
  )

  it('keeps a hold selection alive through its own selection update', () => {
    const session = {},
      snapshot = {},
      selections = {}
    controller.selectionChanged(session, snapshot, selections)
    word.mockImplementation(() => {
      const selected = {}
      controller.acceptSelection(session, snapshot, selected)
      controller.selectionChanged(session, snapshot, selected)
      return { start: 6, end: 11 }
    })
    dispatchTouch(row, 'touchstart')
    vi.advanceTimersByTime(550)
    expect(element.dataset.editorTouchSelecting).toBe('true')
    dispatchTouch(row, 'touchend', 20, 0)
    vi.advanceTimersByTime(16)
    expect(notify).toHaveBeenLastCalledWith('end', 'word', { x: 20, y: 20, bottom: 36 })
  })

  it('cancels a gesture when a host changes selection during the touch callback', () => {
    const session = {},
      snapshot = {},
      selections = {}
    controller.selectionChanged(session, snapshot, selections)
    word.mockImplementation(() => {
      const selected = {}
      controller.acceptSelection(session, snapshot, selected)
      controller.selectionChanged(session, snapshot, selected)
      controller.selectionChanged(session, snapshot, {})
      return { start: 6, end: 11 }
    })
    dispatchTouch(row, 'touchstart')
    vi.advanceTimersByTime(550)
    expect(element.hasAttribute('data-editor-touch-selecting')).toBe(false)
    expect(notify).toHaveBeenLastCalledWith('cancel', null)
    dispatchTouch(row, 'touchend', 20, 0)
    vi.advanceTimersByTime(16)
    expect(notify).toHaveBeenLastCalledWith('cancel', null)
  })

  it('cancels deferred settlement when focusing changes the selection', () => {
    const session = {},
      snapshot = {},
      selections = {}
    controller.selectionChanged(session, snapshot, selections)
    focus.mockImplementation(() => controller.selectionChanged(session, snapshot, {}))
    dispatchTouch(row, 'touchstart')
    vi.advanceTimersByTime(550)
    dispatchTouch(row, 'touchend', 20, 0)
    vi.advanceTimersByTime(16)
    expect(notify).toHaveBeenLastCalledWith('cancel', null)
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
