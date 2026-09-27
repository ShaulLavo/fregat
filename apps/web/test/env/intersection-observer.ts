import { onTestFinished, vi } from 'vitest'

// happy-dom never delivers intersections. Reports here only reach observed targets.
export function stubIntersectionObserver(initiallyIntersecting = false) {
  const previous = globalThis.IntersectionObserver
  const observers: ControlledIntersectionObserver[] = []

  class ControlledIntersectionObserver implements IntersectionObserver {
    readonly root = null
    readonly rootMargin = '0px'
    readonly scrollMargin = '0px'
    readonly thresholds = [0]
    readonly targets = new Set<Element>()

    constructor(readonly callback: IntersectionObserverCallback) {
      observers.push(this)
    }

    observe(target: Element) {
      this.targets.add(target)
      queueMicrotask(() => this.report(target, initiallyIntersecting))
    }

    unobserve(target: Element) {
      this.targets.delete(target)
    }

    disconnect = vi.fn(() => {
      this.targets.clear()
    })

    takeRecords(): IntersectionObserverEntry[] {
      return []
    }

    report(target: Element, isIntersecting: boolean) {
      if (!this.targets.has(target)) return
      const rect = target.getBoundingClientRect()
      this.callback(
        [
          {
            target,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
            boundingClientRect: rect,
            intersectionRect: isIntersecting ? rect : new DOMRectReadOnly(),
            rootBounds: null,
            time: performance.now(),
          },
        ],
        this,
      )
    }
  }

  globalThis.IntersectionObserver = ControlledIntersectionObserver
  onTestFinished(() => {
    globalThis.IntersectionObserver = previous
  })
  return observers
}
