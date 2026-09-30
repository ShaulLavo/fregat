import { afterEach, describe, expect, it } from 'vitest'
import type { Editor } from '@singapore-editor/core/editor'
import { createVisibleEditor } from './support/visibleEditor'
import { createDiffPlugin } from '../src'

describe('createDiffPlugin (overlay mode)', () => {
  let container: HTMLElement | null = null
  let editor: Editor | null = null

  afterEach(() => {
    editor?.dispose()
    container?.remove()
    editor = null
    container = null
  })

  it('renders live injected deletions, recomputes after edits, and clears when disabled', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const plugin = createDiffPlugin({ mode: 'overlay' })
    editor = createVisibleEditor(container, { plugins: [plugin] })

    editor.openDocument({ documentId: 'note.txt', text: 'a\nb\nadd\n' })
    plugin.setBaseFile({ path: 'note.txt', text: 'a\nremove\nb\n' })
    plugin.setEnabled(true)

    expect(container.querySelector('.editor-diff-row-deletion')?.textContent).toBe('remove')
    expect(container.querySelector('.editor-diff-row-addition')?.textContent).toBe('add')
    // In document order, not as a membership check. `toContain('2-')` passes just as happily on a
    // gutter whose numbers have all slid down a row, which is exactly the regression that reached
    // review: overlay's projection array interleaves injected deletions, so indexing it by buffer
    // row labels `b` as the deleted line and steals `add`'s `+`.
    expect(visibleDiffGutterTexts()).toEqual(['11', '2-', '32', '3+', '44'])
    // The diff lane shares this gutter with the host's lanes, so only its own cell is tinted.
    expect(container.querySelector('.editor-diff-gutter')?.classList).toContain(
      'editor-diff-gutter-tinted',
    )
    expect(container.querySelector('[class*="editor-diff-gutter-band-"]')).toBeNull()

    editor.edit({
      from: editor.materializeFullText().length,
      to: editor.materializeFullText().length,
      text: 'more\n',
    })

    expect([...container.querySelectorAll('.editor-diff-row-addition')].at(-1)?.textContent).toBe(
      'more',
    )

    plugin.setEnabled(false)

    expect(container.querySelector('.editor-diff-row-deletion')).toBeNull()
    expect(container.querySelector('.editor-diff-row-addition')).toBeNull()
    expect(visibleDiffGutterTexts()).toEqual([])
  })
})

function visibleDiffGutterTexts(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.editor-diff-gutter')]
    .filter((element) => !element.hidden)
    .map((element) => element.textContent ?? '')
}
