import { onTestFinished } from 'vitest'

// happy-dom's ResizeObserver never reports. This one sends the report a browser
// sends when observation starts, sized from getBoundingClientRect.
export function stubResizeObserver() {
  const previous = globalThis.ResizeObserver

  class ReportingResizeObserver implements ResizeObserver {
    readonly targets = new Set<Element>()

    constructor(readonly callback: ResizeObserverCallback) {}

    observe(target: Element) {
      this.targets.add(target)
      queueMicrotask(() => this.report(target))
    }

    unobserve(target: Element) {
      this.targets.delete(target)
    }

    disconnect() {
      this.targets.clear()
    }

    report(target: Element) {
      if (!this.targets.has(target)) return

      const rect = target.getBoundingClientRect()
      const size = [{ blockSize: rect.height, inlineSize: rect.width }]
      this.callback(
        [
          {
            target,
            contentRect: rect,
            borderBoxSize: size,
            contentBoxSize: size,
            devicePixelContentBoxSize: size,
          },
        ],
        this,
      )
    }
  }

  globalThis.ResizeObserver = ReportingResizeObserver
  onTestFinished(() => {
    globalThis.ResizeObserver = previous
  })
}
