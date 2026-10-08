// Rendered E019 persistence regression from PR review, using the same authored E017 graph.
import { afterEach, expect, test } from 'vitest'
import { commands } from 'vitest/browser'
import {
  createHistoryPanel,
  type HistoryPanel,
} from '../../../examples/app/src/components/historyPanel'
import '../../../examples/app/src/style.css'
import { EditorRoom } from './editor-fixture'

let room: EditorRoom | undefined
let panel: HistoryPanel | undefined

afterEach(() => {
  panel?.dispose()
  room?.dispose()
  panel = undefined
  room = undefined
  document.body.replaceChildren()
})

function openPanel(): void {
  panel = createHistoryPanel(room!.editors[0]!)
  room!.host.append(panel.element)
  panel.setOpen(true)
}

function row(id: number): HTMLElement {
  return panel!.element.querySelector<HTMLElement>(`[data-history-node="${id}"][role="option"]`)!
}

function reopenHistory(): void {
  const { buffer, view } = room!.editors[0]!.getBufferSession()!
  const saved = structuredClone(buffer.serializeHistory())!
  buffer.clearHistory(view)
  expect(buffer.restoreHistory(saved)).toBe(true)
  panel!.dispose()
  panel!.element.remove()
  openPanel()
}

test('rendered restored sibling branches keep their ID-space change sizes through remote edits', async () => {
  room = new EditorRoom(2, 'A')
  openPanel()
  const editor = room.editors[0]!
  const { buffer } = editor.getBufferSession()!
  buffer.breakTypingRun()
  editor.edit({ from: 1, to: 1, text: 'B' })
  room.flush()
  const b = buffer.getHistoryGraph().currentId
  editor.dispatchCommand('undo')
  room.flush()
  editor.edit({ from: 1, to: 1, text: 'C' })
  room.flush()
  const c = buffer.getHistoryGraph().currentId
  room.editors[1]!.edit({ from: 0, to: 0, text: 'R' })
  room.flush()
  expect(room.texts()).toEqual(['RAC', 'RAC'])
  expect(row(b).textContent).toContain('programmatic-edit +1')
  expect(row(c).textContent).toContain('programmatic-edit +1')
  row(b).click()
  panel!.element.querySelector<HTMLButtonElement>('button')!.click()
  room.flush()
  expect(room.texts()).toEqual(['RAB', 'RAB'])
  await commands.editorLook('e019-branches-before-reopen')
  reopenHistory()
  await commands.editorLook('e019-branches-after-reopen')
  expect(row(b).textContent).toContain('programmatic-edit +1')
  expect(row(c).textContent).toContain('programmatic-edit +1')
  expect(row(b).textContent).toContain('●')
  expect(panel!.element.querySelectorAll('#history-graph circle')).toHaveLength(3)
})

test('rendered restored deletion keeps its ID-space change size through a remote insertion', async () => {
  room = new EditorRoom(2, 'AB')
  openPanel()
  const editor = room.editors[0]!
  editor.edit({ from: 1, to: 2, text: '' })
  room.flush()
  const { buffer } = editor.getBufferSession()!
  const deletion = buffer.getHistoryGraph().currentId
  room.editors[1]!.edit({ from: 0, to: 0, text: 'R' })
  room.flush()
  expect(row(deletion).textContent).toContain('programmatic-edit -1')
  reopenHistory()
  await commands.editorLook('e019-deletion-after-reopen')
  expect(row(deletion).textContent).toContain('programmatic-edit -1')
  expect(room.texts()).toEqual(['RA', 'RA'])
})
