import { afterEach, expect, test } from 'vitest'

import { Editor } from '../src/editor/Editor'
import '../src/style.css'

const text = Array.from({ length: 200 }, (_, index) => `function target${index}() {}`).join('\n')
const editors: Editor[] = []
const containers: HTMLElement[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const container of containers.splice(0)) container.remove()
})

async function mountEditor() {
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;flex-direction:column;width:600px;height:240px'
  document.body.append(container)
  containers.push(container)
  const editor = new Editor(container, { defaultText: text })
  editors.push(editor)
  const scroller = container.querySelector<HTMLElement>('.editor-virtualized')
  if (!scroller) throw new Error('Editor did not mount its viewport')
  await expect.poll(() => scroller.clientHeight).toBe(240)
  return { container, editor, scroller }
}

function targetOffset(line: number) {
  return text.indexOf(`target${line}()`)
}

function targetRow(container: HTMLElement, line: number) {
  const row = container.querySelector<HTMLElement>(
    `.editor-virtualized-row[data-editor-virtual-row="${line}"]`,
  )
  if (!row) throw new Error(`Target row ${line} is not mounted`)
  return row
}

async function expectCentered(container: HTMLElement, scroller: HTMLElement, line: number) {
  await expect
    .poll(() => {
      const row = targetRow(container, line).getBoundingClientRect()
      const viewport = scroller.getBoundingClientRect()
      return Math.abs(row.top + row.height / 2 - (viewport.top + scroller.clientHeight / 2))
    })
    .toBeLessThan(1)
}

test.each([
  { from: 150, to: 40 },
  { from: 40, to: 150 },
  { from: 40, to: 41 },
])('centers a jump from line $from to line $to', async ({ from, to }) => {
  const { container, editor, scroller } = await mountEditor()
  editor.setSelection(targetOffset(from), targetOffset(from), { revealBlock: 'center' })
  await expectCentered(container, scroller, from)
  editor.setSelection(targetOffset(to), targetOffset(to) + `target${to}`.length, {
    revealBlock: 'center',
    revealOffset: targetOffset(to),
  })
  editor.focus()

  await expectCentered(container, scroller, to)
})

test('centers a long definition on its start instead of its selection end', async () => {
  const { container, editor, scroller } = await mountEditor()
  editor.setSelection(targetOffset(50), targetOffset(150), {
    revealBlock: 'center',
    revealOffset: targetOffset(50),
  })
  editor.focus()

  await expectCentered(container, scroller, 50)
})

test('clamps centered jumps at the document boundaries', async () => {
  const { container, editor, scroller } = await mountEditor()
  editor.setSelection(targetOffset(100), targetOffset(100), { revealBlock: 'center' })
  editor.setSelection(0, 0, { revealBlock: 'center' })
  expect(scroller.scrollTop).toBe(0)

  editor.setSelection(text.length, text.length, { revealBlock: 'center' })
  await expect
    .poll(() => {
      const row = targetRow(container, 199).getBoundingClientRect()
      return Math.abs(row.bottom - scroller.getBoundingClientRect().bottom)
    })
    .toBeLessThan(1)
})

test('centers a target that is off screen and leaves one on screen where it is', async () => {
  const { container, editor, scroller } = await mountEditor()
  editor.setSelection(targetOffset(120), targetOffset(120), { revealBlock: 'center-if-outside' })
  await expectCentered(container, scroller, 120)

  // Two lines down is still in view: a jump there must not move the page under
  // the reader, which is what unconditional centering does on every step.
  const settled = scroller.scrollTop
  editor.setSelection(targetOffset(122), targetOffset(122), { revealBlock: 'center-if-outside' })
  editor.focus()
  await new Promise((resolve) => requestAnimationFrame(resolve))

  expect(scroller.scrollTop).toBe(settled)
})
