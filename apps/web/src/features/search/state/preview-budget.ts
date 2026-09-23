import { searchPreviewMaxLength } from '@/features/search/utils/preview-length'

/** Ref callback for a row's truncating preview cell. Keeps one identity for memoized rows. */
export type MeasurePreviewCell = (node: HTMLElement | null) => (() => void) | undefined

export type PreviewBudget = {
  readonly measureCell: MeasurePreviewCell
  readonly subscribe: (listener: () => void) => () => void
  readonly maxLength: () => number | undefined
}

/**
 * The preview character budget, measured from the cells the rows render: one observer for every
 * mounted cell, and the glyph width from the cell's own font. The narrowest cell wins, so a
 * match stays visible in every row, including one narrowed by its Replace button.
 */
export function createPreviewBudget(): PreviewBudget {
  const widths = new Map<Element, number>()
  const listeners = new Set<() => void>()
  let observer: ResizeObserver | null = null
  let glyphWidth = 0
  let maxLength: number | undefined

  function update() {
    const next = searchPreviewMaxLength(Math.min(...widths.values()), glyphWidth)
    if (next === maxLength) return

    maxLength = next
    for (const listener of listeners) listener()
  }

  function observe(node: HTMLElement) {
    // Read once, synchronously, so the first rows paint with a budget instead of re-windowing.
    if (widths.size === 0) {
      glyphWidth = measureGlyphWidth(node)
      widths.set(node, node.clientWidth)
      update()
    }
    if (typeof ResizeObserver === 'undefined') return

    observer ??= new ResizeObserver((entries) => {
      for (const entry of entries) widths.set(entry.target, entry.contentRect.width)
      update()
    })
    observer.observe(node)
  }

  function unobserve(node: HTMLElement) {
    widths.delete(node)
    observer?.unobserve(node)
    if (widths.size > 0) return

    observer?.disconnect()
    observer = null
  }

  return {
    measureCell(node) {
      if (!node) return undefined

      observe(node)
      return () => unobserve(node)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    maxLength: () => maxLength,
  }
}

function measureGlyphWidth(node: HTMLElement): number {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return 0

  context.font = getComputedStyle(node).font
  return context.measureText('0').width
}
