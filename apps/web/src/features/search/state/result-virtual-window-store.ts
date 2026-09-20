import {
  SEARCH_RESULT_VIRTUAL_FALLBACK_COUNT,
  SEARCH_RESULT_VIRTUAL_OVERSCAN_IDLE_DELAY_MS,
  SEARCH_RESULT_VIRTUAL_PADDING,
  SEARCH_RESULT_VIRTUAL_ROW_OFFSET,
} from '@/features/search/utils/result-editor-constants'
import type {
  SearchResultVirtualOverscanLevel,
  SearchResultVirtualRowScrollTarget,
  SearchResultVirtualScrollSample,
} from '@/features/search/utils/result-editor-types'
import {
  searchResultFileEditorRenderViewport,
  searchResultVirtualOverscan,
  searchResultVirtualOverscanLevel,
} from '@/features/search/utils/result-editor'
import {
  clampSearchResultVirtualListScrollTop,
  scrollTopForSearchResultVirtualListItem,
  searchResultVirtualListItemsEqual,
  visibleSearchResultVirtualListItems,
  type SearchResultVirtualListMetrics,
  type SearchResultVirtualListViewport,
} from '@/features/search/utils/result-virtual-list'

export type SearchResultVirtualWindow = {
  readonly items: SearchResultVirtualListMetrics['items']
  readonly totalSize: number
  readonly viewport: SearchResultVirtualListViewport
}

export type SearchResultVirtualWindowChangeHandler = (window: SearchResultVirtualWindow) => void

export type SearchResultVirtualWindowScheduler = {
  readonly cancelFrame: (id: number) => void
  readonly clearTimeout: (id: number) => void
  readonly now: () => number
  readonly requestFrame: (callback: () => void) => number
  readonly setTimeout: (callback: () => void, delayMs: number) => number
}

type SearchResultVirtualWindowStoreOptions = {
  readonly initialViewport?: SearchResultVirtualListViewport
  readonly metrics: SearchResultVirtualListMetrics
  readonly onChange?: SearchResultVirtualWindowChangeHandler | null
  readonly scheduler?: SearchResultVirtualWindowScheduler
}

type SearchResultScrollTopOptions = {
  readonly publish?: 'defer' | 'sync'
  readonly updateVelocity?: boolean
}

const INITIAL_SEARCH_RESULT_VIRTUAL_WINDOW_VIEWPORT = {
  height: 0,
  top: 0,
} satisfies SearchResultVirtualListViewport

export class SearchResultVirtualWindowStore {
  private frame = 0
  private idleTimeout = 0
  private metrics: SearchResultVirtualListMetrics
  private onChange: SearchResultVirtualWindowChangeHandler | null
  private overscanLevel: SearchResultVirtualOverscanLevel = 0
  private sample: SearchResultVirtualScrollSample | null = null
  private scheduler: SearchResultVirtualWindowScheduler
  private viewport = INITIAL_SEARCH_RESULT_VIRTUAL_WINDOW_VIEWPORT
  private window: SearchResultVirtualWindow

  public constructor({
    initialViewport = INITIAL_SEARCH_RESULT_VIRTUAL_WINDOW_VIEWPORT,
    metrics,
    onChange = null,
    scheduler = defaultSearchResultVirtualWindowScheduler(),
  }: SearchResultVirtualWindowStoreOptions) {
    this.metrics = metrics
    this.viewport = initialViewport
    this.onChange = onChange
    this.scheduler = scheduler
    this.window = this.nextWindow()
  }

  public dispose(): void {
    this.cancelScheduledFrame()
    this.cancelIdleTimeout()
    this.onChange = null
  }

  public getViewportHeight(): number {
    return this.viewport.height
  }

  public getWindow(): SearchResultVirtualWindow {
    return this.window
  }

  public setChangeHandler(onChange: SearchResultVirtualWindowChangeHandler | null): void {
    this.onChange = onChange
  }

  public setMetrics(metrics: SearchResultVirtualListMetrics): void {
    if (this.metrics === metrics) return

    this.metrics = metrics
    this.publishIfWindowChanged()
  }

  public setScrollTop(top: number, options: SearchResultScrollTopOptions = {}): void {
    const nextTop = Math.max(0, top)
    if (nextTop === this.viewport.top) return

    this.viewport = {
      height: this.viewport.height,
      top: nextTop,
    }
    if (options.updateVelocity !== false) this.updateOverscanLevel(nextTop)
    if (options.publish === 'sync') {
      this.publishIfWindowChanged()
      return
    }

    this.schedulePublish()
  }

  public setViewportHeight(height: number): void {
    const nextHeight = Math.max(0, height)
    if (nextHeight === this.viewport.height) return

    this.viewport = {
      height: nextHeight,
      top: this.viewport.top,
    }
    this.publishIfWindowChanged()
  }

  public scrollTopForIndex(
    index: number,
    target?: SearchResultVirtualRowScrollTarget | null,
  ): number | null {
    if (this.viewport.height <= 0) return null

    return scrollTopForSearchResultVirtualListItem(this.metrics, index, this.viewport, {
      itemOffset: SEARCH_RESULT_VIRTUAL_ROW_OFFSET,
      targetOffset: target?.offset,
      targetSize: target?.size,
      totalPadding: SEARCH_RESULT_VIRTUAL_PADDING,
    })
  }

  public scrollTopForOffset(offset: number): number {
    return clampSearchResultVirtualListScrollTop(
      offset,
      this.metrics.totalSize + SEARCH_RESULT_VIRTUAL_PADDING,
      this.viewport.height,
    )
  }

  private cancelIdleTimeout(): void {
    if (this.idleTimeout === 0) return

    this.scheduler.clearTimeout(this.idleTimeout)
    this.idleTimeout = 0
  }

  private cancelScheduledFrame(): void {
    if (this.frame === 0) return

    this.scheduler.cancelFrame(this.frame)
    this.frame = 0
  }

  private nextWindow(): SearchResultVirtualWindow {
    return {
      items: visibleSearchResultVirtualListItems(this.metrics, this.viewport, {
        fallbackCount: SEARCH_RESULT_VIRTUAL_FALLBACK_COUNT,
        overscan: searchResultVirtualOverscan(this.viewport.height, this.overscanLevel),
      }),
      totalSize: this.metrics.totalSize,
      viewport: searchResultFileEditorRenderViewport(this.viewport),
    }
  }

  private publishIfWindowChanged(): void {
    const next = this.nextWindow()
    if (searchResultVirtualWindowsEqual(this.window, next)) return

    this.window = next
    this.onChange?.(next)
  }

  private resetOverscanLevelSoon(): void {
    this.cancelIdleTimeout()
    this.idleTimeout = this.scheduler.setTimeout(() => {
      this.idleTimeout = 0
      this.setOverscanLevel(0)
    }, SEARCH_RESULT_VIRTUAL_OVERSCAN_IDLE_DELAY_MS)
  }

  private schedulePublish(): void {
    if (this.frame !== 0) return

    this.frame = this.scheduler.requestFrame(() => {
      this.frame = 0
      this.publishIfWindowChanged()
    })
  }

  private setOverscanLevel(level: SearchResultVirtualOverscanLevel): void {
    if (level === this.overscanLevel) return

    this.overscanLevel = level
    this.publishIfWindowChanged()
  }

  private updateOverscanLevel(top: number): void {
    const time = this.scheduler.now()
    const previous = this.sample
    this.sample = { time, top }
    this.resetOverscanLevelSoon()
    if (!previous) return

    const elapsed = time - previous.time
    if (elapsed <= 0) return

    const velocity = Math.abs(top - previous.top) / elapsed
    const level = searchResultVirtualOverscanLevel(velocity)
    if (level <= this.overscanLevel) return

    this.overscanLevel = level
  }
}

function searchResultVirtualWindowsEqual(
  left: SearchResultVirtualWindow,
  right: SearchResultVirtualWindow,
) {
  return (
    left.totalSize === right.totalSize &&
    left.viewport.height === right.viewport.height &&
    left.viewport.top === right.viewport.top &&
    searchResultVirtualListItemsEqual(left.items, right.items)
  )
}

function defaultSearchResultVirtualWindowScheduler(): SearchResultVirtualWindowScheduler {
  return {
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    clearTimeout: (id) => window.clearTimeout(id),
    now: () => performance.now(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  }
}
