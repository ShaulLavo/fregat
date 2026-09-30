import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'
import { generateFixture } from '../../../examples/stress/src/fixtures.ts'
import { inspectProjections, installProjections } from './editBatchProjections.mjs'

let editor = null
let source = ''
let kind = 'single-edit'
let phase = 'inactive'
let synchronous = null
let deferred = null
let initial = null

function counts() {
  return { fullTextReads: 0, sourceBytesRead: 0, fullTextBytesRead: 0, sourceIndexBytesRead: 0 }
}

function diagnostic(event) {
  if (phase === 'inactive') return
  const target = phase === 'synchronous' ? synchronous : deferred
  if (event.name === 'textSnapshot.sourceIndex')
    target.sourceIndexBytesRead += event.detail.sourceBytesRead
  if (event.name !== 'textSnapshot.read') return
  target.fullTextReads += event.detail.fullTextReads
  target.sourceBytesRead += event.detail.sourceBytesRead
  if (event.detail.fullTextReads) target.fullTextBytesRead += event.detail.sourceBytesRead
}

async function prepare(fixture, operation, instrumented, decorated) {
  phase = 'inactive'
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = instrumented ? diagnostic : undefined
  editor?.dispose()
  document.body.replaceChildren()
  source = generateFixture(fixture)
  kind = operation
  const host = document.createElement('div')
  host.id = 'editor'
  host.style.cssText = 'position:relative;width:800px;height:800px;display:flex;overflow:hidden'
  document.body.append(host)
  editor = new Editor(host, { wordWrap: false, textMetrics: { rowHeight: 20, characterWidth: 8 } })
  editor.openDocument({ documentId: 'e032.txt', text: source })
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)
  initial = decorated ? installProjections(editor) : null
}

function edit() {
  synchronous = counts()
  deferred = counts()
  phase = 'synchronous'
  const startedAt = performance.now()
  const edits = [{ from: 0, to: 0, text: 'prefix\n' }]
  if (kind === 'sparse-batch')
    edits.push({ from: source.length, to: source.length, text: '\nsuffix' })
  editor.edit(edits)
  const committedAt = performance.now()
  phase = 'deferred'
  return { startedAt, committedAt, synchronous, projections: inspectProjections(editor, initial) }
}

function inspect() {
  phase = 'inactive'
  const expected = `prefix\n${source}${kind === 'single-edit' ? '' : '\nsuffix'}`
  const textCorrect = editor.materializeFullText() === expected
  const firstRow = document.querySelector('[data-editor-virtual-row="0"]')
  const last = editor.getTextSnapshot().readRange(expected.length - 32, expected.length)
  return {
    textCorrect,
    firstRow: firstRow?.textContent,
    suffixCorrect: last === expected.slice(-32),
    deferred,
    projections: inspectProjections(editor, initial),
  }
}

function dispose() {
  phase = 'inactive'
  editor?.dispose()
  editor = null
  source = ''
  initial = null
  document.body.replaceChildren()
}

function clearFoldsOnNextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      editor.setSyntaxFolds([])
      resolve()
    })
  })
}

function fullReadOnNextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      editor.materializeFullText()
      resolve()
    })
  })
}

export const bridge = {
  prepare,
  edit,
  inspect,
  dispose,
  clearFoldsOnNextFrame,
  fullReadOnNextFrame,
}
