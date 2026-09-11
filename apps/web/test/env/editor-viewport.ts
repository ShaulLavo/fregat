import { onTestFinished } from 'vitest'

// happy-dom has no layout engine; virtual editors need the measurements a browser supplies.
export function stubEditorViewport({ width = 800, height = 600 } = {}) {
  const previous = globalThis.ResizeObserver

  class EditorResizeObserver implements ResizeObserver {
    readonly targets = new Set<Element>()

    constructor(readonly callback: ResizeObserverCallback) {}

    observe(target: Element) {
      if (!target.classList.contains('editor-virtualized')) return
      this.targets.add(target)
      queueMicrotask(() => this.measure(target))
    }

    unobserve(target: Element) {
      this.targets.delete(target)
    }

    disconnect() {
      this.targets.clear()
    }

    measure(target: Element) {
      if (!this.targets.has(target)) return
      const size = [{ blockSize: height, inlineSize: width }]
      this.callback(
        [
          {
            target,
            contentRect: new DOMRect(0, 0, width, height),
            borderBoxSize: size,
            contentBoxSize: size,
            devicePixelContentBoxSize: size,
          },
        ],
        this,
      )
    }
  }

  globalThis.ResizeObserver = EditorResizeObserver
  onTestFinished(() => {
    globalThis.ResizeObserver = previous
  })
}
