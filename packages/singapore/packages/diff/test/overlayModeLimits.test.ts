import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Editor } from '@singapore-editor/core/editor'
import { createVisibleEditor } from './support/visibleEditor'
import { createDiffPlugin } from '../src'
import { highlightRangesWithin, installHighlightPolyfill } from './support/highlightPolyfill'

let container: HTMLElement | null = null
let editor: Editor | null = null

/**
 * The documented overlay-mode limit, held down here so it cannot rot into folklore.
 *
 * `injectedTextDisplayRow` gives an injected row `startOffset === endOffset`
 * (displayTransforms.ts:887-888). Downstream, `rangeSegments` returns `[]` for
 * `row.source === 'injected'` (virtualizedTextViewGeometry.ts:398) and `textOffsetFromDomBoundary`
 * returns null (virtualizedTextViewRows.ts:2508), so an injected row has no geometry to draw a
 * selection against and no offset to map a click onto.
 *
 * Token painting is the exception, and not in overlay mode's favour. Chunk offsets are derived as
 * `rowStartOffset + localIndex`, not from the row's `endOffset`, so the degenerate-range bail at
 * virtualizedTextViewHighlights.ts:759,:805 never fires — and the injected row is painted with
 * whatever tokens live at `[anchorOffset, anchorOffset + text.length)` in the *document* buffer.
 * Those are some following document line's tokens, not the deleted line's. Overlay deletions are
 * not uncoloured; they are miscoloured, which is the worse of the two.
 *
 * What the three cases below assert is deliberately what is *observable*, not what is merely true.
 * Selection painting is not: happy-dom has no layout, so no selection highlight registers for any
 * row, injected or not, and an assertion about it would discriminate nothing. Copy is asserted
 * through the editor's own selection model rather than a DOM Range, because `handleCopy` reads
 * `resolvedSelections()` (inputSelectionController.ts:2468, :2945) and never consults
 * `document.getSelection()` — a hand-built DOM range proves nothing about either.
 *
 * This is the counter-test to test/documentMode.test.ts. It is what makes the M0 gate falsifiable,
 * and it is the citation to point at (plan R4) when someone proposes collapsing the two modes into
 * `overlay`. If it starts failing, injected rows changed shape and §C2 needs rewriting — establish
 * what the new behaviour is before touching the assertions.
 */
describe('overlay-mode injected rows cannot reach parity (§C2)', () => {
  beforeAll(() => {
    installHighlightPolyfill()
  })

  afterEach(() => {
    editor?.dispose()
    container?.remove()
    editor = null
    container = null
  })

  it('paints an injected deletion row with the anchor line’s tokens, not its own', () => {
    const mounted = mountLiveDiff()
    // Document buffer 'a\nb\nadd\n': 'a' = [0,1), 'b' = [2,3), 'add' = [4,7).
    mounted.editor.setTokens([
      { start: 0, end: 1, style: { color: 'rgb(255, 0, 0)' } },
      { start: 2, end: 3, style: { color: 'rgb(0, 255, 0)' } },
      { start: 4, end: 7, style: { color: 'rgb(0, 0, 255)' } },
    ])

    const deletion = mounted.container.querySelector<HTMLElement>('.editor-diff-row-deletion')
    expect(deletion?.textContent).toBe('remove')

    // Ranges land, but they are the 'b' and 'add' tokens smeared across "remove" at the character
    // positions those tokens occupy after the anchor offset — 'r' from the 'b' token, 'move' from
    // the 'add' token. Nothing here knows the deleted line's own text.
    const painted = highlightRangesWithin(deletion!).map(
      (range) => `${range.startOffset}-${range.endOffset}`,
    )
    expect(painted).toEqual(['0-1', '2-5'])
  })

  it('breaks the row-index identity §C4 depends on', () => {
    // An injected row takes a display slot without adding a buffer line, so from the first
    // deletion onwards a row's rendered index no longer equals the document line it shows. This is
    // the §C2 forfeit of §C4 stated as an observable fact rather than an inference.
    //
    // It is also the trap that produced a real regression in this very package: the overlay gutter
    // briefly resolved rows as `projectionRows[bufferRow]`, which mislabelled every row below the
    // first deletion. Anything addressing rows by index must be document-mode only; overlay code
    // goes through `rowsByBufferRow`.
    const mounted = mountLiveDiff()
    const lines = mounted.editor.materializeFullText().split('\n')

    const rendered = [
      ...mounted.container.querySelectorAll<HTMLElement>('[data-editor-virtual-row]'),
    ]
    const mismatched = rendered.filter(
      (row) => lines[Number(row.dataset.editorVirtualRow)] !== row.textContent,
    )

    expect(rendered.length).toBeGreaterThan(0)
    // The injected 'remove' row itself, then every row below it — shifted one slot past its own
    // line, right down to the trailing empty one, which is pushed off the end of the buffer.
    expect(mismatched.map((row) => row.textContent)).toEqual(['remove', 'b', 'add', ''])
  })

  it('cannot copy a deleted line, because it is not in the document at all', () => {
    // The consequence of the two above, and the reason `document` mode exists: in overlay mode the
    // deleted text lives only in the projection, never in the buffer, so no selection can reach it
    // and no copy can carry it.
    const mounted = mountLiveDiff()
    mounted.editor.setSelection(0, mounted.editor.materializeFullText().length)

    const copied = copyFrom(mounted.container)
    expect(copied).toBe('a\nb\nadd\n')
    expect(copied).not.toContain('remove')
  })
})

function mountLiveDiff(): { container: HTMLElement; editor: Editor } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const plugin = createDiffPlugin({ mode: 'overlay' })
  const mounted = createVisibleEditor(host, { plugins: [plugin] })

  mounted.openDocument({ documentId: 'note.txt', text: 'a\nb\nadd\n' })
  plugin.setBaseFile({ path: 'note.txt', text: 'a\nremove\nb\n' })
  plugin.setEnabled(true)

  container = host
  editor = mounted
  return { container: host, editor: mounted }
}

function copyFrom(host: HTMLElement): string {
  const element = host.querySelector<HTMLElement>('.editor')
  if (!element) throw new Error('Expected a mounted editor')

  const transfer = new DataTransfer()
  const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: transfer })
  element.dispatchEvent(event)
  return transfer.getData('text/plain')
}
