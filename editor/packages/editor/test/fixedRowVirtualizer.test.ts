import { describe, expect, it, vi } from 'vitest'
import {
  computeFixedRowTotalSize,
  computeFixedRowVirtualItems,
  computeFixedRowVisibleRange,
  FixedRowVirtualizer,
} from '../src/virtualization/fixedRowVirtualizer'

describe('fixed row virtualizer', () => {
  it('computes total scroll height from count and row height', () => {
    expect(computeFixedRowTotalSize(100_000, 18)).toBe(1_800_000)
    expect(computeFixedRowTotalSize(-1, 18)).toBe(0)
    expect(computeFixedRowTotalSize(2, 0)).toBe(2)
  })

  it('computes an exclusive visible range from scroll metrics', () => {
    const range = computeFixedRowVisibleRange({
      count: 100,
      rowHeight: 20,
      scrollTop: 45,
      viewportHeight: 50,
    })

    expect(range).toEqual({ start: 2, end: 5 })
  })

  it.each([
    {
      layout: 'fixed',
      rowSizes: undefined,
      positions: [
        [12, 0.5],
        [22, 22 / 24],
        [24, 1],
        [36, 1.5],
        [58, 2.5],
        [500, 2.95],
      ] satisfies readonly [number, number][],
    },
    {
      layout: 'variable',
      rowSizes: [20, 60, 20],
      positions: [
        [12, 0.5],
        [22, 22 / 24],
        [24, 1],
        [56, 1.5],
        [86, 1 + 62 / 64],
        [98, 2.5],
        [500, 2.95],
      ] satisfies readonly [number, number][],
    },
  ])(
    'projects continuous $layout row positions through gaps and the document bottom',
    ({ rowSizes, positions }) => {
      const virtualizer = new FixedRowVirtualizer({ count: 3, rowHeight: 20, rowGap: 4, rowSizes })
      for (const [scrollTop, expected] of positions) {
        virtualizer.setScrollMetrics({ scrollTop, viewportHeight: 1 })
        expect(virtualizer.getViewportSnapshot().scrollRow).toBeCloseTo(expected)
      }
      virtualizer.dispose()
    },
  )

  it('keeps the final row coordinate in trailing viewport padding and clears it while hidden', () => {
    const virtualizer = new FixedRowVirtualizer({ count: 3, rowHeight: 20, rowGap: 4 })
    virtualizer.setScrollMetrics({ scrollTop: 500, viewportHeight: 100 })
    expect(virtualizer.getViewportSnapshot()).toMatchObject({
      scrollTop: 48,
      scrollRow: 2,
      visibleRange: { start: 2, end: 3 },
    })
    virtualizer.setScrollMetrics({ scrollTop: 48, viewportHeight: 0 })
    expect(virtualizer.getViewportSnapshot().scrollRow).toBe(0)
    virtualizer.updateOptions({ count: 0 })
    virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 100 })
    expect(virtualizer.getViewportSnapshot().scrollRow).toBe(0)
    virtualizer.dispose()
  })

  it.each([0, -20, Number.NaN])('keeps a %s-height viewport empty', (viewportHeight) => {
    const range = computeFixedRowVisibleRange({
      count: 100,
      rowHeight: 20,
      scrollTop: 40,
      viewportHeight,
    })

    expect(range).toEqual({ start: 0, end: 0 })
  })

  it('renders the final row when a visible viewport starts at the document end', () => {
    expect(
      computeFixedRowVisibleRange({
        count: 100,
        rowHeight: 20,
        scrollTop: 2_000,
        viewportHeight: 100,
      }),
    ).toEqual({ start: 99, end: 100 })
  })

  it('does not expand an empty range through overscan', () => {
    expect(
      computeFixedRowVirtualItems({
        count: 100,
        rowHeight: 20,
        range: { start: 50, end: 50 },
        overscan: 6,
      }),
    ).toEqual([])
  })

  it.each(['fixed', 'indexed'] as const)(
    'suspends %s rows before measurement and across hide/show cycles',
    (layout) => {
      const virtualizer = new FixedRowVirtualizer({
        count: 100,
        rowHeight: 20,
        rowSizes: layout === 'indexed' ? blockLayout(100, 5, 60) : undefined,
        overscan: 6,
      })

      expect(virtualizer.getSnapshot().virtualItems).toEqual([])
      virtualizer.setScrollMetrics({ scrollTop: 1_000, viewportHeight: 100 })
      const visible = virtualizer.getSnapshot()
      expect(visible.virtualItems).toHaveLength(17)

      virtualizer.setScrollMetrics({ scrollTop: 1_000, viewportHeight: 0 })
      expect(virtualizer.getSnapshot()).toMatchObject({
        totalSize: visible.totalSize,
        scrollTop: 1_000,
        visibleRange: { start: 0, end: 0 },
        virtualItems: [],
      })

      virtualizer.updateOptions({ overscan: 8 })
      expect(virtualizer.getSnapshot().virtualItems).toEqual([])
      virtualizer.setScrollMetrics({ scrollTop: 1_000, viewportHeight: 100 })
      expect(virtualizer.getSnapshot().visibleRange).toEqual(visible.visibleRange)
      expect(virtualizer.getSnapshot().virtualItems).toHaveLength(21)
      virtualizer.dispose()
    },
  )

  it('distinguishes unmeasured static content from a measured hidden viewport', () => {
    const onChange = vi.fn()
    const virtualizer = new FixedRowVirtualizer({
      count: 5,
      rowHeight: 20,
      scrollMode: 'static',
    })
    virtualizer.attachScrollElement(document.createElement('div'), onChange)
    expect(virtualizer.getSnapshot().virtualItems).toHaveLength(5)

    virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 0 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(virtualizer.getSnapshot()).toMatchObject({
      totalSize: 100,
      scrollHeight: 100,
      viewportHeight: 0,
      virtualItems: [],
    })

    virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 100 })
    expect(virtualizer.getSnapshot().virtualItems).toHaveLength(5)
    virtualizer.dispose()
  })

  it('computes overscanned virtual items', () => {
    const items = computeFixedRowVirtualItems({
      count: 100,
      rowHeight: 20,
      range: { start: 10, end: 13 },
      overscan: 2,
    })

    expect(items).toEqual([
      { index: 8, start: 160, size: 20 },
      { index: 9, start: 180, size: 20 },
      { index: 10, start: 200, size: 20 },
      { index: 11, start: 220, size: 20 },
      { index: 12, start: 240, size: 20 },
      { index: 13, start: 260, size: 20 },
      { index: 14, start: 280, size: 20 },
    ])
  })

  it('keeps a stable virtual window until the visible range reaches the deadband', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 100,
      rowHeight: 10,
      overscan: 4,
    })

    virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 30 })
    expect(virtualizer.getSnapshot().virtualItems.map((item) => item.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ])

    virtualizer.setScrollMetrics({ scrollTop: 10, viewportHeight: 30 })
    expect(virtualizer.getSnapshot().virtualItems.map((item) => item.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ])

    virtualizer.setScrollMetrics({ scrollTop: 30, viewportHeight: 30 })
    expect(virtualizer.getSnapshot().virtualItems.map((item) => item.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ])
  })

  it('defers scroll-only changes to one trailing emit with the exact final position', () => {
    vi.useFakeTimers()

    try {
      const onChange = vi.fn()
      const virtualizer = new FixedRowVirtualizer({
        count: 100,
        overscan: 2,
        rowHeight: 20,
      })
      const element = document.createElement('div')

      virtualizer.attachScrollElement(element, onChange, {
        readInitialScrollPosition: false,
      })
      virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 60 })
      virtualizer.getSnapshot()
      onChange.mockClear()

      // Same stable window, untouched geometry: no immediate emit...
      virtualizer.setScrollMetrics({ scrollTop: 5, viewportHeight: 60 })
      expect(onChange).not.toHaveBeenCalled()

      // ...but the exact position is emitted once scrolling stops.
      vi.advanceTimersByTime(200)
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ scrollTop: 5 }))

      onChange.mockClear()

      // A stable-window shift still emits immediately and supersedes the trailing emit.
      virtualizer.setScrollMetrics({ scrollTop: 200, viewportHeight: 60 })
      expect(onChange).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(200)
      expect(onChange).toHaveBeenCalledTimes(1)

      onChange.mockClear()

      // Horizontal scroll is geometry: always immediate.
      virtualizer.setScrollMetrics({ scrollLeft: 4, scrollTop: 200, viewportHeight: 60 })
      expect(onChange).toHaveBeenCalledTimes(1)

      virtualizer.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports each scroll offset without rebuilding a stable virtual window', () => {
    const onChange = vi.fn()
    const offsets: number[] = []
    const virtualizer = new FixedRowVirtualizer({ count: 100, rowHeight: 20, overscan: 2 })
    virtualizer.attachScrollElement(document.createElement('div'), onChange, {
      readInitialScrollPosition: false,
      onScroll: () => offsets.push(virtualizer.getViewportSnapshot().scrollTop),
    })
    virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 60 })
    onChange.mockClear()
    const snapshots = vi.spyOn(virtualizer, 'getSnapshot')

    virtualizer.setScrollMetrics({ scrollTop: 5, viewportHeight: 60 })
    virtualizer.setScrollMetrics({ scrollTop: 10, viewportHeight: 60 })
    virtualizer.setScrollMetrics({ scrollTop: 10, viewportHeight: 60 })

    expect(offsets).toEqual([5, 10])
    expect(onChange).not.toHaveBeenCalled()
    expect(snapshots).not.toHaveBeenCalled()

    virtualizer.detachScrollElement()
    virtualizer.setScrollMetrics({ scrollTop: 15, viewportHeight: 60 })
    expect(offsets).toEqual([5, 10])
    virtualizer.dispose()
  })

  it('emits every scroll change while the native scroll height is capped', () => {
    const onChange = vi.fn()
    const virtualizer = new FixedRowVirtualizer({
      count: 1000,
      maxScrollHeight: 500,
      overscan: 2,
      rowHeight: 20,
    })
    const element = document.createElement('div')

    virtualizer.attachScrollElement(element, onChange, {
      readInitialScrollPosition: false,
    })
    virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 100 })
    virtualizer.getSnapshot()
    onChange.mockClear()

    // The spacer transform derives from scrollTop every frame in capped mode,
    // so even a sub-row scroll must emit.
    virtualizer.setScrollMetrics({ scrollTop: 5, viewportHeight: 100 })
    expect(onChange).toHaveBeenCalledTimes(1)

    virtualizer.dispose()
  })

  it('computes fixed row gaps without adding a trailing gap', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 3,
      rowHeight: 20,
      rowGap: 4,
      overscan: 0,
    })

    virtualizer.setScrollMetrics({ scrollTop: 21, viewportHeight: 25 })

    expect(virtualizer.getSnapshot()).toMatchObject({
      totalSize: 68,
      visibleRange: { start: 1, end: 2 },
      virtualItems: [{ index: 1, start: 24, size: 20 }],
    })
  })

  it('reuses stable virtual item records while a row remains mounted', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 100,
      rowHeight: 20,
      overscan: 1,
    })

    virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 60 })
    const first = virtualizer.getSnapshot().virtualItems
    const rowTwo = first.find((item) => item.index === 2)

    virtualizer.setScrollMetrics({ scrollTop: 5, viewportHeight: 60 })
    const second = virtualizer.getSnapshot().virtualItems
    const nextRowTwo = second.find((item) => item.index === 2)

    expect(nextRowTwo).toBe(rowTwo)
  })

  it('can attach to a fresh scroll element without reading scroll offsets', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 100,
      rowHeight: 20,
    })
    const element = document.createElement('div')
    const scrollTop = vi.spyOn(element, 'scrollTop', 'get')
    const scrollLeft = vi.spyOn(element, 'scrollLeft', 'get')

    virtualizer.attachScrollElement(element, undefined, {
      readInitialScrollPosition: false,
    })

    expect(scrollTop).not.toHaveBeenCalled()
    expect(scrollLeft).not.toHaveBeenCalled()

    virtualizer.dispose()
  })

  it('renders the full document range in static scroll mode', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 5,
      rowHeight: 20,
      overscan: 0,
      scrollMode: 'static',
    })

    virtualizer.setScrollMetrics({ scrollTop: 60, viewportHeight: 40 })

    expect(virtualizer.getSnapshot()).toMatchObject({
      nativeScrollHeight: 100,
      nativeScrollTop: 0,
      scrollHeight: 100,
      scrollTop: 0,
      totalSize: 100,
      viewportHeight: 100,
      visibleRange: { start: 0, end: 5 },
      virtualItems: [
        { index: 0, start: 0, size: 20 },
        { index: 1, start: 20, size: 20 },
        { index: 2, start: 40, size: 20 },
        { index: 3, start: 60, size: 20 },
        { index: 4, start: 80, size: 20 },
      ],
    })
  })

  it('skips scroll listeners and logical scroll properties in static scroll mode', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 100,
      rowHeight: 20,
      scrollMode: 'static',
    })
    const element = document.createElement('div')
    const addEventListener = vi.spyOn(element, 'addEventListener')

    virtualizer.attachScrollElement(element, undefined, {
      readInitialScrollPosition: false,
    })

    expect(addEventListener).not.toHaveBeenCalled()
    expect(Object.getOwnPropertyDescriptor(element, 'scrollTop')).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(element, 'scrollHeight')).toBeUndefined()

    virtualizer.dispose()
  })

  it('does not write native scrollTop when option updates keep the native offset unchanged', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 1,
      rowHeight: 20,
    })
    const element = document.createElement('div')
    let nativeScrollTop = 0
    const setNativeScrollTop = vi.fn((value: number) => {
      nativeScrollTop = value
    })

    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => nativeScrollTop,
      set: setNativeScrollTop,
    })

    virtualizer.attachScrollElement(element, undefined, {
      readInitialScrollPosition: false,
    })
    virtualizer.updateOptions({ count: 10_000 })

    expect(setNativeScrollTop).not.toHaveBeenCalled()

    virtualizer.setScrollMetrics({ scrollTop: 200, viewportHeight: 100 })
    expect(setNativeScrollTop).toHaveBeenCalledWith(200)

    setNativeScrollTop.mockClear()
    virtualizer.updateOptions({ count: 20_000 })

    expect(setNativeScrollTop).not.toHaveBeenCalled()

    virtualizer.dispose()
  })

  it('does not emit changes when option updates keep the normalized geometry unchanged', () => {
    const onChange = vi.fn()
    const virtualizer = new FixedRowVirtualizer({
      count: 10,
      overscan: 2,
      rowHeight: 20,
    })
    const element = document.createElement('div')

    virtualizer.attachScrollElement(element, onChange, {
      readInitialScrollPosition: false,
    })
    virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 60 })
    onChange.mockClear()

    virtualizer.updateOptions({ count: 10, overscan: 2, rowHeight: 20 })

    expect(onChange).not.toHaveBeenCalled()

    virtualizer.updateOptions({ count: 11 })

    expect(onChange).toHaveBeenCalledTimes(1)

    virtualizer.dispose()
  })

  it('does not read native scrollTop while syncing resize entries', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const frameScheduler = installFrameScheduler()
    const observers: TestResizeObserver[] = []

    globalThis.ResizeObserver = class extends TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback)
        observers.push(this)
      }
    } as typeof ResizeObserver

    try {
      const virtualizer = new FixedRowVirtualizer({
        count: 100,
        rowHeight: 20,
      })
      const element = document.createElement('div')
      let nativeScrollTop = 0
      const getNativeScrollTop = vi.fn(() => nativeScrollTop)

      Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get: getNativeScrollTop,
        set: (value: number) => {
          nativeScrollTop = value
        },
      })

      virtualizer.attachScrollElement(element, undefined, {
        readInitialScrollPosition: false,
      })
      virtualizer.setScrollMetrics({ scrollTop: 200, viewportHeight: 100 })

      getNativeScrollTop.mockClear()
      observers[0]?.resize(element, 320, 160)

      expect(getNativeScrollTop).not.toHaveBeenCalled()
      expect(virtualizer.getSnapshot()).toMatchObject({
        scrollTop: 200,
        viewportHeight: 100,
        viewportWidth: 0,
      })

      frameScheduler.flush()

      expect(getNativeScrollTop).not.toHaveBeenCalled()
      expect(virtualizer.getSnapshot()).toMatchObject({
        scrollTop: 200,
        viewportHeight: 160,
        viewportWidth: 320,
      })

      virtualizer.dispose()
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
      frameScheduler.restore()
    }
  })

  it('coalesces resize entries into one frame update with the latest dimensions', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const frameScheduler = installFrameScheduler()
    const observers: TestResizeObserver[] = []

    globalThis.ResizeObserver = class extends TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback)
        observers.push(this)
      }
    } as typeof ResizeObserver

    try {
      const onChange = vi.fn()
      const virtualizer = new FixedRowVirtualizer({
        count: 100,
        rowHeight: 20,
      })
      const element = document.createElement('div')

      virtualizer.attachScrollElement(element, onChange, {
        readInitialScrollPosition: false,
      })
      virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 100, viewportWidth: 100 })
      onChange.mockClear()

      observers[0]?.resize(element, 320, 160)
      observers[0]?.resize(element, 640, 240)

      expect(onChange).not.toHaveBeenCalled()
      expect(frameScheduler.pendingCount()).toBe(1)

      frameScheduler.flush()

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(virtualizer.getSnapshot()).toMatchObject({
        viewportHeight: 240,
        viewportWidth: 640,
      })

      virtualizer.dispose()
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
      frameScheduler.restore()
    }
  })

  it('combines a pending resize with the next scroll sync', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const frameScheduler = installFrameScheduler()
    const observers: TestResizeObserver[] = []

    globalThis.ResizeObserver = class extends TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback)
        observers.push(this)
      }
    } as typeof ResizeObserver

    try {
      const onChange = vi.fn()
      const virtualizer = new FixedRowVirtualizer({
        count: 100,
        rowHeight: 20,
      })
      const element = document.createElement('div')
      let nativeScrollTop = 0

      Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get: () => nativeScrollTop,
        set: (value: number) => {
          nativeScrollTop = value
        },
      })

      virtualizer.attachScrollElement(element, onChange, {
        readInitialScrollPosition: false,
      })
      virtualizer.setScrollMetrics({ scrollTop: 200, viewportHeight: 100, viewportWidth: 100 })
      onChange.mockClear()

      observers[0]?.resize(element, 320, 160)
      nativeScrollTop = 260
      element.scrollLeft = 12
      element.dispatchEvent(new Event('scroll'))

      expect(frameScheduler.pendingCount()).toBe(1)

      frameScheduler.flush()

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(virtualizer.getSnapshot()).toMatchObject({
        scrollLeft: 12,
        scrollTop: 260,
        viewportHeight: 160,
        viewportWidth: 320,
      })

      virtualizer.dispose()
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
      frameScheduler.restore()
    }
  })

  it('combines a pending resize with logical scrollTop writes', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const frameScheduler = installFrameScheduler()
    const observers: TestResizeObserver[] = []

    globalThis.ResizeObserver = class extends TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback)
        observers.push(this)
      }
    } as typeof ResizeObserver

    try {
      const virtualizer = new FixedRowVirtualizer({
        count: 100,
        rowHeight: 20,
      })
      const element = document.createElement('div')

      virtualizer.attachScrollElement(element, undefined, {
        readInitialScrollPosition: false,
      })
      virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 100, viewportWidth: 100 })

      observers[0]?.resize(element, 320, 160)
      element.scrollTop = 260

      expect(frameScheduler.pendingCount()).toBe(0)
      expect(virtualizer.getSnapshot()).toMatchObject({
        scrollTop: 260,
        viewportHeight: 160,
        viewportWidth: 320,
      })

      virtualizer.dispose()
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
      frameScheduler.restore()
    }
  })

  it.each(['fixed', 'indexed'] as const)(
    'restores deep %s scrolling after hidden native geometry collapses',
    (layout) => {
      const resize = installResizeObservers()
      const frames = installFrameScheduler()
      const virtualizer = new FixedRowVirtualizer({
        count: 1_000,
        rowHeight: 20,
        rowSizes: layout === 'indexed' ? blockLayout(1_000, 5, 60) : undefined,
        maxScrollHeight: 1_000,
        overscan: 6,
      })
      const element = document.createElement('div')
      let nativeScrollTop = 0
      const writeScrollTop = vi.fn((value: number) => {
        nativeScrollTop = value
      })
      Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get: () => nativeScrollTop,
        set: writeScrollTop,
      })

      try {
        virtualizer.attachScrollElement(element, undefined, { readInitialScrollPosition: false })
        element.scrollLeft = 300
        virtualizer.setScrollMetrics({
          scrollTop: 10_000,
          scrollLeft: 300,
          viewportHeight: 100,
          viewportWidth: 320,
        })
        const visible = virtualizer.getSnapshot()
        writeScrollTop.mockClear()

        nativeScrollTop = 0
        element.scrollLeft = 0
        resize.resize(element, 0, 0)
        element.dispatchEvent(new Event('scroll'))
        frames.flush()

        expect(virtualizer.getSnapshot()).toMatchObject({
          scrollTop: 10_000,
          scrollLeft: 300,
          totalSize: visible.totalSize,
          virtualItems: [],
        })
        expect(writeScrollTop).not.toHaveBeenCalled()
        element.dispatchEvent(new Event('scroll'))
        frames.flush()
        expect(virtualizer.getSnapshot().scrollTop).toBe(10_000)

        resize.resize(element, 320, 100)
        element.dispatchEvent(new Event('scroll'))
        frames.flush()

        expect(virtualizer.getSnapshot()).toEqual(visible)
        expect(nativeScrollTop).toBe(visible.nativeScrollTop)
        expect(element.scrollLeft).toBe(300)
        expect(writeScrollTop).toHaveBeenCalledTimes(1)
      } finally {
        virtualizer.dispose()
        frames.restore()
        resize.restore()
      }
    },
  )

  it('keeps the hidden row anchor while indexed rows change above it', () => {
    const virtualizer = anchoredVirtualizer(blockLayout(200, 5, 60))
    virtualizer.setScrollMetrics({ scrollTop: 1_000, viewportHeight: 0 })

    virtualizer.updateOptions({ rowSizes: blockLayout(200, 5, 160) })

    expect(virtualizer.getSnapshot()).toMatchObject({
      scrollTop: 1_100,
      totalSize: 4_140,
      virtualItems: [],
    })
    virtualizer.setScrollMetrics({ scrollTop: 1_100, viewportHeight: 100 })
    expect(topVisibleRow(virtualizer)).toEqual({ index: 48, offsetInViewport: 0 })
    virtualizer.dispose()
  })

  it('preserves scrolling when a hide and reveal coalesce before the next frame', () => {
    const resize = installResizeObservers()
    const frames = installFrameScheduler()
    const virtualizer = new FixedRowVirtualizer({ count: 100, rowHeight: 20 })
    const element = document.createElement('div')
    let nativeScrollTop = 0
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => nativeScrollTop,
      set: (value: number) => {
        nativeScrollTop = value
      },
    })

    try {
      virtualizer.attachScrollElement(element, undefined, { readInitialScrollPosition: false })
      element.scrollLeft = 200
      virtualizer.setScrollMetrics({
        scrollTop: 1_000,
        scrollLeft: 200,
        viewportHeight: 100,
        viewportWidth: 320,
      })
      const visible = virtualizer.getSnapshot()

      nativeScrollTop = 0
      element.scrollLeft = 0
      resize.resize(element, 0, 0)
      resize.resize(element, 320, 100)
      element.dispatchEvent(new Event('scroll'))
      frames.flush()

      expect(virtualizer.getSnapshot()).toEqual(visible)
      expect(nativeScrollTop).toBe(1_000)
      expect(element.scrollLeft).toBe(200)
    } finally {
      virtualizer.dispose()
      frames.restore()
      resize.restore()
    }
  })

  it.each([0, 600])(
    'restores the end-of-file offset with an initial viewport height of %s',
    (initialViewportHeight) => {
      const virtualizer = new FixedRowVirtualizer({ count: 0, rowHeight: 20 })
      const element = document.createElement('div')
      let nativeScrollTop = 0
      let nativeMaximum = 0
      Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get: () => nativeScrollTop,
        set: (value: number) => {
          nativeScrollTop = Math.min(value, nativeMaximum)
        },
      })
      virtualizer.attachScrollElement(
        element,
        (snapshot) => {
          nativeMaximum = Math.max(0, snapshot.nativeScrollHeight - 600)
        },
        { readInitialScrollPosition: false },
      )
      if (initialViewportHeight > 0)
        virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: initialViewportHeight })
      virtualizer.requestScrollTop(3_980)
      virtualizer.updateOptions({ count: 200 })
      expect(nativeScrollTop).toBe(initialViewportHeight > 0 ? 3_980 : 0)

      virtualizer.setScrollMetrics({ scrollTop: 3_980, viewportHeight: 600 })

      expect(virtualizer.getSnapshot().scrollTop).toBe(3_980)
      expect(nativeScrollTop).toBe(3_980)
      virtualizer.dispose()
    },
  )

  it('restores native scrolling after the revealed snapshot renders its spacer', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 100,
      rowHeight: 20,
      maxScrollHeight: 1_000,
    })
    const element = document.createElement('div')
    let nativeScrollTop = 0
    let nativeScrollLeft = 0
    let nativeMaximum = 900
    Object.defineProperties(element, {
      scrollTop: {
        configurable: true,
        get: () => nativeScrollTop,
        set: (value: number) => {
          nativeScrollTop = Math.min(value, nativeMaximum)
        },
      },
      scrollLeft: {
        configurable: true,
        get: () => nativeScrollLeft,
        set: (value: number) => {
          nativeScrollLeft = Math.min(value, nativeMaximum)
        },
      },
    })
    virtualizer.attachScrollElement(
      element,
      (snapshot) => {
        nativeMaximum = snapshot.viewportHeight > 0 ? 900 : 0
      },
      { readInitialScrollPosition: false },
    )
    virtualizer.setScrollMetrics({ scrollTop: 1_000, scrollLeft: 500, viewportHeight: 100 })
    virtualizer.setScrollMetrics({ scrollTop: 1_000, viewportHeight: 0 })
    virtualizer.updateOptions({ count: 200 })

    virtualizer.setScrollMetrics({ scrollTop: 1_000, viewportHeight: 100 })

    expect(nativeScrollTop).toBe(virtualizer.getSnapshot().nativeScrollTop)
    expect(nativeScrollLeft).toBe(500)
    virtualizer.dispose()
  })

  it('cancels pending resize work when detached', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const frameScheduler = installFrameScheduler()
    const observers: TestResizeObserver[] = []

    globalThis.ResizeObserver = class extends TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback)
        observers.push(this)
      }
    } as typeof ResizeObserver

    try {
      const onChange = vi.fn()
      const virtualizer = new FixedRowVirtualizer({
        count: 100,
        rowHeight: 20,
      })
      const element = document.createElement('div')

      virtualizer.attachScrollElement(element, onChange, {
        readInitialScrollPosition: false,
      })
      virtualizer.setScrollMetrics({ scrollTop: 1_000, viewportHeight: 0 })
      onChange.mockClear()

      observers[0]?.resize(element, 320, 160)
      element.dispatchEvent(new Event('scroll'))
      expect(frameScheduler.pendingCount()).toBe(1)

      virtualizer.dispose()
      frameScheduler.flush()

      expect(onChange).not.toHaveBeenCalled()
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
      frameScheduler.restore()
    }
  })

  it('tracks the viewport border box separately from the content box', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 100,
      rowHeight: 20,
    })

    virtualizer.setScrollMetrics({
      scrollTop: 0,
      viewportHeight: 60,
      viewportWidth: 80,
      borderBoxHeight: 72,
      borderBoxWidth: 96,
    })

    expect(virtualizer.getSnapshot()).toMatchObject({
      borderBoxHeight: 72,
      borderBoxWidth: 96,
      viewportHeight: 60,
      viewportWidth: 80,
    })
  })

  it('clears stable records when row height changes', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 100,
      rowHeight: 20,
      overscan: 1,
    })

    virtualizer.setScrollMetrics({ scrollTop: 0, viewportHeight: 60 })
    const rowOne = virtualizer.getSnapshot().virtualItems[1]
    virtualizer.updateOptions({ rowHeight: 24 })

    expect(virtualizer.getSnapshot().virtualItems[1]).not.toBe(rowOne)
    expect(virtualizer.getSnapshot().virtualItems[1]).toEqual({
      index: 1,
      start: 24,
      size: 24,
    })
  })

  it('supports variable row sizes', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 3,
      rowHeight: 20,
      rowSizes: [20, 60, 20],
      overscan: 0,
    })

    virtualizer.setScrollMetrics({ scrollTop: 30, viewportHeight: 40 })

    expect(virtualizer.getSnapshot()).toMatchObject({
      totalSize: 100,
      visibleRange: { start: 1, end: 2 },
      virtualItems: [{ index: 1, start: 20, size: 60 }],
    })
  })

  it('applies row gaps between variable rows', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 3,
      rowHeight: 20,
      rowGap: 4,
      rowSizes: [20, 60, 20],
      overscan: 0,
    })

    virtualizer.setScrollMetrics({ scrollTop: 22, viewportHeight: 40 })

    expect(virtualizer.getSnapshot()).toMatchObject({
      totalSize: 108,
      visibleRange: { start: 1, end: 2 },
      virtualItems: [{ index: 1, start: 24, size: 60 }],
    })
  })

  it('keeps the top visible row in place when a row above the viewport grows', () => {
    const virtualizer = anchoredVirtualizer(blockLayout(200, 5, 60))

    expect(topVisibleRow(virtualizer)).toEqual({ index: 48, offsetInViewport: 0 })

    virtualizer.updateOptions({ rowSizes: blockLayout(200, 5, 160) })

    expect(topVisibleRow(virtualizer)).toEqual({ index: 48, offsetInViewport: 0 })
    expect(virtualizer.getSnapshot().scrollTop).toBe(1_100)
  })

  it('keeps the top visible row in place when a row is inserted above the viewport', () => {
    const virtualizer = anchoredVirtualizer(blockLayout(200, 5, 60))
    const inserted = blockLayout(200, 5, 60)
    inserted.splice(20, 0, 100)

    virtualizer.updateOptions({ count: 201, rowSizes: inserted })

    // Row 48 is row 49 now, one insertion further down the layout.
    expect(topVisibleRow(virtualizer)).toEqual({ index: 49, offsetInViewport: 0 })
    expect(virtualizer.getSnapshot().scrollTop).toBe(1_100)
  })

  it('keeps the top visible row in place when rows above the viewport are folded away', () => {
    const virtualizer = anchoredVirtualizer(blockLayout(200, 12, 60))
    const folded = blockLayout(200, 12, 60)
    folded.splice(10, 5)

    virtualizer.updateOptions({ count: 195, rowSizes: folded })

    expect(topVisibleRow(virtualizer)).toEqual({ index: 43, offsetInViewport: 0 })
    expect(virtualizer.getSnapshot().scrollTop).toBe(860)
  })

  it('keeps the top visible row in place when the last variable row is withdrawn', () => {
    const virtualizer = anchoredVirtualizer(blockLayout(200, 5, 200))

    const before = topVisibleRow(virtualizer)

    // Every row is the base height now, so this layout carries no height index
    // at all — which is a uniform document, not an unanchorable one.
    virtualizer.updateOptions({ rowSizes: undefined })

    expect(topVisibleRow(virtualizer)).toEqual(before)
    expect(virtualizer.getSnapshot().scrollTop).toBe(1_000 - (200 - 20))
  })

  it('does not carry the scroll offset into an unrelated row set', () => {
    const virtualizer = anchoredVirtualizer(blockLayout(200, 5, 60))

    // A different document: one row shorter, and its tall row sits elsewhere.
    virtualizer.updateOptions({ count: 199, rowSizes: blockLayout(199, 120, 60) })

    expect(virtualizer.getSnapshot().scrollTop).toBe(1_000)
    expect(topVisibleRow(virtualizer)).toEqual({ index: 50, offsetInViewport: 0 })
  })

  it('caps native scroll height while preserving logical scroll offsets', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 1_000,
      maxScrollHeight: 1_000,
      overscan: 0,
      rowHeight: 100,
    })

    virtualizer.setScrollMetrics({ scrollTop: 99_900, viewportHeight: 100 })

    expect(virtualizer.getSnapshot()).toMatchObject({
      nativeScrollHeight: 1_000,
      nativeScrollTop: 900,
      scrollHeight: 100_000,
      scrollTop: 99_900,
      visibleRange: { start: 999, end: 1_000 },
    })
  })

  it('keeps large-file rows addressable past native browser scroll caps', () => {
    const targetRow = 699_051
    const virtualizer = new FixedRowVirtualizer({
      count: targetRow + 100,
      overscan: 0,
      rowHeight: 48,
    })

    virtualizer.setScrollMetrics({
      scrollTop: targetRow * 48,
      viewportHeight: 480,
    })

    expect(virtualizer.getSnapshot()).toMatchObject({
      nativeScrollHeight: 16_000_000,
      visibleRange: { start: targetRow, end: targetRow + 10 },
    })
  })

  it('exposes logical scroll metrics on attached scroll elements', () => {
    const virtualizer = new FixedRowVirtualizer({
      count: 1_000,
      maxScrollHeight: 1_000,
      overscan: 0,
      rowHeight: 100,
    })
    const element = document.createElement('div')

    virtualizer.attachScrollElement(element, undefined, {
      readInitialScrollPosition: false,
    })
    virtualizer.setScrollMetrics({ scrollTop: 99_900, viewportHeight: 100 })

    expect(element.scrollHeight).toBe(100_000)
    expect(element.scrollTop).toBe(99_900)

    element.scrollTop = 49_950

    expect(virtualizer.getSnapshot()).toMatchObject({
      nativeScrollTop: 450,
      scrollTop: 49_950,
      visibleRange: { start: 499, end: 501 },
    })

    virtualizer.dispose()
  })
})

// Uniform 20px text rows with one taller row standing in for a block surface.
function blockLayout(count: number, blockRow: number, blockHeight: number): number[] {
  const rowSizes = Array.from({ length: count }, () => 20)
  rowSizes[blockRow] = blockHeight
  return rowSizes
}

// Scrolled far enough that row 48 starts exactly at the top of the viewport,
// with the taller row well above it.
function anchoredVirtualizer(rowSizes: readonly number[]): FixedRowVirtualizer {
  const virtualizer = new FixedRowVirtualizer({
    count: rowSizes.length,
    rowHeight: 20,
    rowSizes,
    overscan: 0,
  })

  virtualizer.setScrollMetrics({ scrollTop: 1_000, viewportHeight: 100 })
  return virtualizer
}

function topVisibleRow(virtualizer: FixedRowVirtualizer): {
  index: number
  offsetInViewport: number
} {
  const snapshot = virtualizer.getSnapshot()
  const item = snapshot.virtualItems[0]!
  return { index: item.index, offsetInViewport: item.start - snapshot.scrollTop }
}

class TestResizeObserver implements ResizeObserver {
  public readonly observe = vi.fn()
  public readonly unobserve = vi.fn()
  public readonly disconnect = vi.fn()

  public constructor(private readonly callback: ResizeObserverCallback) {}

  public takeRecords(): ResizeObserverEntry[] {
    return []
  }

  public resize(target: Element, width: number, height: number): void {
    this.callback([resizeEntry(target, width, height)], this)
  }
}

function installResizeObservers(): {
  resize(target: Element, width: number, height: number): void
  restore(): void
} {
  const original = globalThis.ResizeObserver
  const observers: TestResizeObserver[] = []
  globalThis.ResizeObserver = class extends TestResizeObserver {
    public constructor(callback: ResizeObserverCallback) {
      super(callback)
      observers.push(this)
    }
  }
  return {
    resize: (target, width, height) => {
      for (const observer of observers) observer.resize(target, width, height)
    },
    restore: () => {
      globalThis.ResizeObserver = original
    },
  }
}

function installFrameScheduler(): {
  flush(): void
  pendingCount(): number
  restore(): void
} {
  const originalRequest = Reflect.get(globalThis, 'requestAnimationFrame') as
    | typeof requestAnimationFrame
    | undefined
  const originalCancel = Reflect.get(globalThis, 'cancelAnimationFrame') as
    | typeof cancelAnimationFrame
    | undefined
  let nextHandle = 1
  const callbacks = new Map<number, FrameRequestCallback>()

  globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback): number => {
    const handle = nextHandle
    nextHandle += 1
    callbacks.set(handle, callback)
    return handle
  })
  globalThis.cancelAnimationFrame = vi.fn((handle: number): void => {
    callbacks.delete(handle)
  })

  return {
    flush: () => {
      const pending = Array.from(callbacks.values())
      callbacks.clear()
      for (const callback of pending) callback(0)
    },
    pendingCount: () => callbacks.size,
    restore: () => {
      restoreFrameFunction('requestAnimationFrame', originalRequest)
      restoreFrameFunction('cancelAnimationFrame', originalCancel)
    },
  }
}

function restoreFrameFunction(
  name: 'requestAnimationFrame' | 'cancelAnimationFrame',
  value: typeof requestAnimationFrame | typeof cancelAnimationFrame | undefined,
): void {
  if (value) {
    Reflect.set(globalThis, name, value)
    return
  }

  Reflect.deleteProperty(globalThis, name)
}

function resizeEntry(target: Element, width: number, height: number): ResizeObserverEntry {
  return {
    borderBoxSize: [resizeBox(width, height)],
    contentBoxSize: [resizeBox(width, height)],
    contentRect: {
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRectReadOnly,
    devicePixelContentBoxSize: [resizeBox(width, height)],
    target,
  }
}

function resizeBox(width: number, height: number): ResizeObserverSize {
  return {
    blockSize: height,
    inlineSize: width,
  }
}
