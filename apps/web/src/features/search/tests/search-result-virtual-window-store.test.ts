import { describe, it } from 'vitest'
import { expect, test } from '../../../../test/fixtures'

import { createSearchResultVirtualListMetrics } from '@/features/search/utils/result-virtual-list'
import {
  SearchResultVirtualWindowStore,
  type SearchResultVirtualWindow,
  type SearchResultVirtualWindowScheduler,
} from '@/features/search/state/result-virtual-window-store'

describe('search result virtual window store', () => {
  test('starts at the retained viewport without rendering the first results', () => {
    const metrics = createSearchResultVirtualListMetrics(
      Array.from({ length: 100 }, (_, index) => ({ key: `row:${index}`, size: 20 })),
    )
    const store = new SearchResultVirtualWindowStore({
      initialViewport: { height: 40, top: 1_120 },
      metrics,
      scheduler: createTestScheduler().scheduler,
    })

    expect(store.getWindow().viewport).toEqual({ height: 40, top: 1_120 })
    expect(store.getWindow().items[0]?.index).toBeGreaterThan(0)
  })

  it('does not publish raw scroll changes while the visible window is unchanged', () => {
    const fixture = createStoreFixture()

    fixture.store.setScrollTop(1)

    expect(fixture.changes).toHaveLength(0)
    fixture.scheduler.flushFrames()
    expect(fixture.changes).toHaveLength(0)
  })

  it('coalesces repeated scroll changes into one animation frame publish', () => {
    const fixture = createStoreFixture()

    fixture.store.setScrollTop(1_000)
    fixture.store.setScrollTop(1_100)

    expect(fixture.scheduler.frameCount()).toBe(1)
    fixture.scheduler.flushFrames()
    expect(fixture.changes).toHaveLength(1)
    expect(fixture.changes[0]?.items[0]?.index).toBeGreaterThan(0)
  })

  it('publishes viewport resize for render viewport consumers', () => {
    const fixture = createStoreFixture()

    fixture.store.setViewportHeight(41)
    expect(fixture.changes).toHaveLength(1)

    fixture.store.setViewportHeight(1_000)
    expect(fixture.changes).toHaveLength(2)
  })

  it('publishes programmatic scroll synchronously', () => {
    const fixture = createStoreFixture()

    fixture.store.setScrollTop(1_000, {
      publish: 'sync',
      updateVelocity: false,
    })

    expect(fixture.changes).toHaveLength(1)
    expect(fixture.scheduler.frameCount()).toBe(0)
  })

  it('exposes a row-aligned viewport for editor line windows', () => {
    const fixture = createStoreFixture()

    expect(fixture.store.getWindow().viewport).toEqual({ height: 40, top: 0 })
    fixture.store.setScrollTop(29, {
      publish: 'sync',
      updateVelocity: false,
    })

    expect(fixture.store.getWindow().viewport).toEqual({ height: 40, top: 28 })
  })
})

function createStoreFixture() {
  const changes: SearchResultVirtualWindow[] = []
  const scheduler = createTestScheduler()
  const store = new SearchResultVirtualWindowStore({
    metrics: createSearchResultVirtualListMetrics(
      Array.from({ length: 100 }, (_, index) => ({
        key: `row:${index}`,
        size: 20,
      })),
    ),
    onChange: (window) => changes.push(window),
    scheduler: scheduler.scheduler,
  })
  store.setViewportHeight(40)
  changes.length = 0

  return {
    changes,
    scheduler,
    store,
  }
}

function createTestScheduler() {
  let nextFrameId = 1
  let nextTimerId = 1
  let time = 0
  const frames = new Map<number, () => void>()
  const timers = new Map<number, () => void>()
  const scheduler = {
    cancelFrame: (id) => frames.delete(id),
    clearTimeout: (id) => timers.delete(id),
    now: () => time,
    requestFrame: (callback) => {
      const id = nextFrameId
      nextFrameId += 1
      frames.set(id, callback)
      return id
    },
    setTimeout: (callback) => {
      const id = nextTimerId
      nextTimerId += 1
      timers.set(id, callback)
      return id
    },
  } satisfies SearchResultVirtualWindowScheduler

  return {
    advance: (ms: number) => {
      time += ms
    },
    flushFrames: () => {
      const callbacks = Array.from(frames.values())
      frames.clear()
      for (const callback of callbacks) {
        callback()
      }
    },
    frameCount: () => frames.size,
    scheduler,
  }
}
