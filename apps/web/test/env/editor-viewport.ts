import { onTestFinished } from 'vitest'

// happy-dom has no layout engine; virtual editors need the measurements a browser supplies.
export function stubEditorViewport({ width = 800, height = 600 } = {}) {
  const previous = globalThis.ResizeObserver

  class EditorResizeObserver implements ResizeObserver {
    readonly targets = new Set<Element>()

    constructor(readonly callback: ResizeObserverCallback) {}

    observe(target: Element) {
      if (!target.classList.contains('editor-virtualized')) return
      // Point queries hit-test against the scroll element's box, which happy-dom leaves empty.
      target.getBoundingClientRect = () => new DOMRect(0, 0, width, height)
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

/**
 * Where a mounted editor row sits on screen under `stubEditorViewport`: the scroll element's box
 * starts at the origin, so a row is its display index times the row height, less the scroll.
 */
export function editorRowPoint(row: HTMLElement) {
  const scroller = row.closest<HTMLElement>('.editor-virtualized')
  const rowHeight = Number.parseFloat(scroller?.style.getPropertyValue('--editor-row-height') ?? '')
  const height = Number.isFinite(rowHeight) ? rowHeight : 24
  const top = Number(row.dataset.editorVirtualRow) * height - (scroller?.scrollTop ?? 0)
  // Past any gutter, halfway down the row.
  return { clientX: 200, clientY: top + height / 2 }
}
