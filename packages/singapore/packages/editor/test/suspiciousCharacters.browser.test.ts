import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../src/style.css'

import { VirtualizedTextView } from '../src/virtualization'

const CYRILLIC_A = 'а'
const ZERO_WIDTH_SPACE = '​'

/**
 * What only a real engine can answer about these markers: a confusable character is marked by
 * underlining the cell it occupies, so the mark has to land on that cell and be as wide as it —
 * and an invisible character occupies no cell at all, so the mark on it has to be given a width
 * from somewhere or there is nothing on screen to see.
 */
describe.skipIf(typeof globalThis.Highlight === 'undefined')(
  'suspicious character markers in a real engine',
  () => {
    let container: HTMLElement
    let view: VirtualizedTextView | null

    beforeEach(() => {
      container = document.createElement('div')
      container.style.height = '120px'
      container.style.width = '360px'
      document.body.appendChild(container)
      view = new VirtualizedTextView(container, { rowHeight: 20, overscan: 0 })
    })

    afterEach(() => {
      view?.dispose()
      container.remove()
      view = null
    })

    function marker(kind: string): HTMLElement {
      const found = container.querySelector<HTMLElement>(
        `.editor-virtualized-hidden-character-marker[data-editor-hidden-character='${kind}']`,
      )
      if (!found) throw new Error(`no ${kind} marker was drawn`)

      return found
    }

    it('draws the mark over the cell the confusable character occupies', () => {
      view!.setText(`const p${CYRILLIC_A}ssword = 1`)
      view!.setScrollMetrics(0, 40)

      const chunk = view!.getState().mountedRows[0]?.chunks[0]
      const character = document.createRange()
      character.setStart(chunk!.textNode, 7)
      character.setEnd(chunk!.textNode, 8)
      const cell = character.getBoundingClientRect()
      const drawn = marker('ambiguous').getBoundingClientRect()

      expect(cell.width).toBeGreaterThan(0)
      expect(drawn.left).toBeCloseTo(cell.left, 0)
      expect(drawn.width).toBeCloseTo(cell.width, 0)
    })

    // The reader has to be able to compare the character with what it imitates, which they cannot
    // do through a mark that covers it.
    it('rules the confusable character underneath rather than covering it', () => {
      view!.setText(`const p${CYRILLIC_A}ssword = 1`)
      view!.setScrollMetrics(0, 40)

      const painted = getComputedStyle(marker('ambiguous'))

      expect(painted.borderBottomWidth).not.toBe('0px')
      expect(painted.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    })

    // The cell it is drawn against measures a fraction of a pixel wide, so "wider than nothing" is
    // a bar the defect this guards against clears too; the mark has to be wide enough to see.
    it('draws a mark with a width of its own on a character that has none', () => {
      view!.setText(`const a =${ZERO_WIDTH_SPACE} 1`)
      view!.setScrollMetrics(0, 40)

      expect(marker('invisible').getBoundingClientRect().width).toBeGreaterThanOrEqual(1)
    })
  },
)
