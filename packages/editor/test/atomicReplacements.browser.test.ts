import { afterEach, expect, test } from 'vitest'

import { Editor } from '../src/editor/Editor'
import type { InlineReplacementSpec } from '../src/inlineMap'
import type { EditorInlineReplacementContext } from '../src/plugins'
import '../src/style.css'

/**
 * A chip measured wider than its placeholder, where a visual move has to take its x from the
 * painted node: next to one, a press used to overshoot the character beside it.
 */

const MENTION = /@[\w./-]+/g
const TEXT = 'see @src/foo.ts now'
const CHIP_START = 4
const CHIP_END = 15

const editors: Editor[] = []
const containers: HTMLElement[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const container of containers.splice(0)) container.remove()
})

function mentionSpecs(context: EditorInlineReplacementContext): readonly InlineReplacementSpec[] {
  const text = context.textSnapshot.readRange(0, context.textSnapshot.length)
  return [...text.matchAll(MENTION)].map((match) => ({
    id: `mention-${match.index}`,
    key: `mention:${match[0]}`,
    startIndex: match.index,
    endIndex: match.index + match[0].length,
    text: match[0],
    atomic: true,
    reveal: 'never',
    render: (element: HTMLElement) => {
      element.textContent = 'a much wider chip than its source'
    },
  }))
}

async function mountChipEditor(rtlMoveVisually: boolean) {
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;flex-direction:column;width:600px;height:120px'
  document.body.append(container)
  containers.push(container)
  const editor = new Editor(container, { inputRoute: 'edit-context', rtlMoveVisually })
  editors.push(editor)
  editor.setText(TEXT)
  editor.setInlineReplacementProvider(mentionSpecs, { trigger: 'edit' })
  const chip = () => container.querySelector<HTMLElement>('[data-editor-inline-widget]')
  await expect.poll(() => chip()?.getBoundingClientRect().width ?? 0).toBeGreaterThan(100)
  editor.focus()
  return editor
}

function caret(editor: Editor): number {
  return editor.getSelections()[0]?.headOffset ?? -1
}

test.each([true, false])(
  'walks across a measured chip one stop at a time (visual %s)',
  async (rtlMoveVisually) => {
    const editor = await mountChipEditor(rtlMoveVisually)
    editor.setSelection(CHIP_END + 1)

    const stops: number[] = []
    for (let press = 0; press < 3; press += 1) {
      editor.dispatchCommand('cursorLeft')
      stops.push(caret(editor))
    }
    expect(stops).toEqual([CHIP_END, CHIP_START, CHIP_START - 1])

    stops.length = 0
    for (let press = 0; press < 3; press += 1) {
      editor.dispatchCommand('cursorRight')
      stops.push(caret(editor))
    }
    expect(stops).toEqual([CHIP_START, CHIP_END, CHIP_END + 1])
  },
)

test('takes the chip whole with one Backspace typed at its end', async () => {
  const editor = await mountChipEditor(true)
  editor.setSelection(CHIP_END)

  editor.dispatchCommand('deleteBackward')

  expect(editor.materializeFullText()).toBe('see  now')
})
