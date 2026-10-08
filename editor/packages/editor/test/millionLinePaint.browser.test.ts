import { afterEach, expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import { Editor } from '../src/editor/Editor'
import '../src/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofKeyPress: (key: string) => Promise<void>
    proofType: (text: string) => Promise<void>
  }
}

let editor: Editor | undefined
let host: HTMLElement | undefined

afterEach(() => {
  editor?.dispose()
  host?.remove()
})

test('paints and hit-tests the last rows after typing in a million-line document', async () => {
  host = document.createElement('div')
  host.style.cssText = 'display:flex;width:600px;height:200px'
  document.body.append(host)
  editor = new Editor(host, { lineHeight: 20, inputRoute: 'textarea' })
  editor.openDocument({ documentId: 'million.txt', text: 'line\n'.repeat(999_999) + 'final' })
  await frames()
  assertPaintedRow(0)
  editor.focus()
  await commands.proofKeyPress('Control+End')
  await commands.proofType(' edited')
  await frames()
  expect(editor.getTextSnapshot().lineCount).toBe(1_000_000)
  expect(editor.getState().cursor.row).toBe(999_999)
  expect(host.querySelector('[data-editor-virtual-row="999999"]')?.textContent).toBe('final edited')
  assertPaintedRow(999_999)
  editor.setScrollPosition({ top: 20_000_000 - 200 })
  await frames()
  assertPaintedRow(999_998)
  assertPaintedRow(999_999)
}, 30_000)

function assertPaintedRow(index: number) {
  const row = host!.querySelector<HTMLElement>(`[data-editor-virtual-row="${index}"]`)!
  expect(row).not.toBeNull()
  const box = row.getBoundingClientRect()
  expect(box.height).toBe(20)
  const hit = document.elementFromPoint(box.left + 8, box.top + box.height / 2)
  expect(hit === row || row.contains(hit)).toBe(true)
}

async function frames() {
  for (let index = 0; index < 3; index++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}
