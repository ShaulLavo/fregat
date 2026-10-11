import { expect, it } from 'vitest'
import '../src/style.css'
import { VirtualizedTextView } from '../src/virtualization'

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
async function settle() {
  await frame()
  await frame()
  await frame()
}

it('keeps recycled text rows in document flow with their measured gaps', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:480px;height:120px;display:flex;flex-direction:column'
  document.body.append(host)
  const view = new VirtualizedTextView(host, { rowHeight: 24, rowGap: 3, overscan: 2 })
  try {
    view.setText(Array.from({ length: 200 }, (_, index) => `row ${index}`).join('\n'))
    await settle()
    for (const top of [0, 540, 270, 1080, 0]) {
      view.scrollElement.scrollTop = top
      await settle()
      const window = host.querySelector<HTMLElement>('.editor-virtualized-text-window')!
      const rows = Array.from(
        window.querySelectorAll<HTMLElement>(':scope > [data-editor-virtual-row]'),
      )
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.length).toBeLessThan(30)
      const indices = rows.map((row) => Number(row.dataset.editorVirtualRow))
      expect(indices.every(Number.isFinite), rows.map((row) => row.outerHTML).join('\n')).toBe(true)
      expect(Number.isFinite(view.getState().scrollTop), JSON.stringify(view.getState())).toBe(true)
      expect(indices).toEqual(indices.toSorted((a, b) => a - b))
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index]!
        expect(getComputedStyle(row).position).toBe('relative')
        expect(row.style.transform).toBe('')
        const expectedTop = indices[index]! * 27 - view.getState().scrollTop
        expect(
          row.getBoundingClientRect().top - view.scrollElement.getBoundingClientRect().top,
        ).toBeCloseTo(expectedTop, 0)
      }
    }
  } finally {
    view.dispose()
    host.remove()
  }
})

it('preserves a native range while retained rows move across recycled siblings', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:480px;height:120px;display:flex;flex-direction:column'
  document.body.append(host)
  const view = new VirtualizedTextView(host, { rowHeight: 24, overscan: 4 })
  try {
    view.setText(Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n'))
    view.scrollElement.scrollTop = 240
    await settle()
    const range = view.createRange(70, 83, { scrollIntoView: false })!
    const selection = document.getSelection()!
    selection.setBaseAndExtent(
      range.endContainer,
      range.endOffset,
      range.startContainer,
      range.startOffset,
    )
    const selected = selection.toString()
    view.scrollElement.scrollTop = 192
    await settle()
    expect(selection.toString()).toBe(selected)
    expect(view.textOffsetFromDomBoundary(selection.anchorNode!, selection.anchorOffset)).toBe(83)
    expect(view.textOffsetFromDomBoundary(selection.focusNode!, selection.focusOffset)).toBe(70)
  } finally {
    document.getSelection()?.removeAllRanges()
    view.dispose()
    host.remove()
  }
})
