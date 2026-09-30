import { Editor, type EditorInitialPaintEvent } from '@singapore-editor/core/editor'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  pointToOffset,
  type EditorTextBuffer,
} from '@singapore-editor/core/document'
import { createError } from '@singapore-editor/core/logging/evlog'
import { createEditorFindPlugin } from '@singapore-editor/find'
import { typeScript } from '@singapore-editor/tree-sitter-languages'
import '@singapore-editor/core/style.css'
import '@singapore-editor/find/style.css'
import { createInputLatencyProbe } from './inputLatency.ts'
import { fixtureFacts, generateFixture, normalizedText, type FixtureId } from './fixtures.ts'

type Diagnostic = {
  readonly name: string
  readonly durationMs?: number
  readonly detail?: Readonly<Record<string, unknown>>
}
type KeySample = {
  readonly key: string
  readonly at: number
  readonly trusted: boolean
  appliedAt: number | null
  frameAt: number | null
}
type Paint = EditorInitialPaintEvent & { readonly at: number }
type Active = {
  readonly buffer: EditorTextBuffer
  readonly editors: readonly Editor[]
  readonly inputAbort: AbortController
}

declare global {
  var __stress: typeof bridge
  var __EDITOR_PERFORMANCE_DIAGNOSTICS__: ((event: Diagnostic) => void) | null
}

let active: Active | null = null
let source = ''
let expected = ''
let paints: Paint[] = []
let diagnostics: Diagnostic[] = []
let droppedDiagnostics = 0
let keys: KeySample[] = []
let frames = new Set<number>()
let released: WeakRef<object>[] = []
let start = 0
let cancelled = false
let fixture: FixtureId = 'ordinary'
let typingTarget = { offset: 0, row: 0 }
const hosts = document.querySelector<HTMLElement>('#views')!

function check(value: unknown, message: string): asserts value {
  if (value) return
  throw createError({
    message,
    code: 'STRESS_CORRECTNESS',
    status: 422,
    why: 'A scenario skipped expected work.',
    fix: 'Inspect the fixture and observed editor state.',
  })
}

function current(): Active {
  check(active, 'No document is open')
  return active
}

async function prepare(id: FixtureId, seed: number, instrumented: boolean) {
  dispose()
  fixture = id
  source = generateFixture(id, seed)
  expected = normalizedText(source)
  cancelled = false
  paints = []
  diagnostics = []
  droppedDiagnostics = 0
  keys = []
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = instrumented
    ? (event) => {
        if (diagnostics.length < 8192) diagnostics.push(event)
        else droppedDiagnostics++
      }
    : null
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  const sha256 = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return { ...fixtureFacts(source), sha256 }
}

function createHost(index: number): HTMLElement {
  const host = document.createElement('section')
  host.id = `view-${index}`
  host.style.width = '900px'
  host.style.height = '320px'
  host.style.position = 'relative'
  host.style.overflow = 'hidden'
  if (index !== 2) host.style.display = 'flex'
  host.hidden = index === 2
  hosts.append(host)
  return host
}

function open(multiple: boolean, highlight: boolean) {
  start = performance.now()
  const buffer = createEditorTextBuffer(source)
  const editors: Editor[] = []
  const inputAbort = new AbortController()
  active = { buffer, editors, inputAbort }
  for (let index = 0; index < (multiple ? 3 : 1); index++) {
    const editor = new Editor(createHost(index), {
      lineHeight: 20,
      plugins: highlight ? [typeScript(), createEditorFindPlugin()] : [createEditorFindPlugin()],
      onInitialPaint: (event) => paints.push({ ...event, at: performance.now() }),
      onChange: (_state, change) => {
        if (change?.kind === 'edit') recordAppliedKey()
        if (index === 0 && change && change.kind !== 'selection' && change.kind !== 'none')
          inputLatency.applied()
      },
    })
    editors.push(editor)
    editor.attachSession(createEditorBufferSession(buffer), {
      documentId: fixture,
      languageId: highlight ? 'typescript' : null,
    })
  }
  editors[0]!
    .getInputElement()
    .addEventListener('keydown', recordKey, { signal: inputAbort.signal, capture: true })
  return { start, attachedAt: performance.now() }
}

function recordKey(event: KeyboardEvent) {
  if (event.key.length !== 1) return
  keys.push({
    key: event.key,
    at: event.timeStamp,
    trusted: event.isTrusted,
    appliedAt: null,
    frameAt: null,
  })
}

function recordAppliedKey() {
  const key = keys.at(-1)
  if (!key || key.appliedAt !== null) return
  key.appliedAt = performance.now()
  const frame = requestAnimationFrame(() => {
    key.frameAt = performance.now()
    frames.delete(frame)
  })
  frames.add(frame)
}

function verifyText(text = expected) {
  const { editors, buffer } = current()
  check(buffer.materializeFullText() === text, 'Shared buffer text differs from expected edits')
  for (const editor of editors)
    check(editor.materializeFullText() === text, 'A view missed the shared edit')
  return { length: text.length, views: editors.length, cursor: editors[0]!.getState().cursor }
}

function jump(fraction: number) {
  const { buffer, editors } = current()
  const lines = expected.split('\n')
  const row = Math.floor((lines.length - 1) * fraction)
  const column = fixture === 'long-line' ? Math.floor(lines[0]!.length * fraction) : 0
  const offset = pointToOffset(buffer.getSnapshot(), { row, column })
  const at = performance.now()
  editors[0]!.setSelection(offset, offset, { reveal: true })
  return { at, row, column, offset, text: lines[row]!.slice(column, column + 24) }
}

function beginTyping() {
  const { editors, buffer } = current()
  const editor = editors[0]!
  const row = Math.min(8, expected.split('\n').length - 1)
  const offset = pointToOffset(buffer.getSnapshot(), { row, column: 0 })
  typingTarget = { row, offset }
  editor.setSelection(offset, offset, { reveal: true })
  editor.focus()
  keys = []
  return typingTarget
}

function finishTyping(typed: string) {
  const text = expected.slice(0, typingTarget.offset) + typed + expected.slice(typingTarget.offset)
  const observation = verifyText(text)
  check(
    observation.cursor.row === typingTarget.row && observation.cursor.column === typed.length,
    'Typing left the wrong caret',
  )
  check(
    keys.length === typed.length &&
      keys.every((key) => key.trusted && key.appliedAt !== null && key.frameAt !== null),
    'Missing trusted key/application/frame samples',
  )
  check(
    document
      .querySelector(`#view-0 [data-editor-virtual-row="${typingTarget.row}"]`)
      ?.textContent?.includes(typed),
    'Typed text was not rendered',
  )
  return { ...observation, keys }
}

async function churn(cycles: number) {
  const { editors, buffer } = current()
  const editor = editors[0]!
  const revision = buffer.getRevision()
  const at = performance.now()
  for (let index = 0; index < cycles; index++) {
    check(!cancelled, 'Scenario cancelled')
    editor.edit({ from: 0, to: 0, text: '😀e\u0301' }, { history: 'record' })
    check(buffer.getTextSnapshot().readRange(0, 4) === '😀e\u0301', 'Churn insertion did not apply')
    editor.edit({ from: 0, to: 4, text: '' }, { history: 'record' })
    if (index % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const durationMs = performance.now() - at
  const revisions = buffer.getRevision() - revision
  check(revisions === cycles * 2, 'Churn skipped document revisions')
  return { durationMs, operations: cycles * 2, revisions, ...verifyText() }
}

function probeViews() {
  current().editors[0]!.edit({ from: 0, to: 0, text: 'probe' })
}

function finishProbe() {
  current().editors[0]!.edit({ from: 0, to: 5, text: '' })
  return verifyText()
}

function revealHidden() {
  const { editors } = current()
  check(editors.length === 3, 'Expected two visible views and one hidden view')
  const host = document.querySelector<HTMLElement>('#view-2')!
  host.hidden = false
  host.style.display = 'flex'
  editors[2]!.setSelection(0, 0, { reveal: true })
  return verifyText('probe' + expected)
}

function observe() {
  const rows = [...hosts.querySelectorAll<HTMLElement>('#view-0 [data-editor-virtual-row]')]
  return {
    geometry: [...hosts.querySelectorAll<HTMLElement>('.editor-virtualized, textarea')].map(
      (element) => ({
        className: element.className,
        rect: element.getBoundingClientRect().toJSON(),
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        windowY: window.scrollY,
      }),
    ),
    now: performance.now(),
    start,
    paints,
    diagnostics,
    droppedDiagnostics,
    state: current().editors[0]!.getState(),
    scroll: current().editors[0]!.getScrollPosition(),
    rows: rows.map((row) => ({
      row: Number(row.dataset.editorVirtualRow),
      text: row.textContent ?? '',
      height: row.getBoundingClientRect().height,
    })),
  }
}

function verifyRows() {
  const lines = expected.split('\n')
  const rows = observe().rows
  for (const row of rows) {
    check(row.text.length > 0 || lines[row.row] === '', 'An expected row rendered empty')
    check(lines[row.row]?.includes(row.text), `Rendered row ${row.row} differs from the fixture`)
  }
  return rows.map((row) => row.row)
}

function dispose() {
  inputLatency.dispose()
  if (active) {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    released = [active.buffer, ...active.editors].map((value) => new WeakRef(value))
    active.inputAbort.abort()
    for (const editor of active.editors) editor.dispose()
  }
  active = null
  for (const frame of frames) cancelAnimationFrame(frame)
  frames.clear()
  hosts.replaceChildren()
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = null
  source = ''
  expected = ''
  paints = []
  keys = []
  diagnostics = []
}

function retention() {
  return {
    trackedObjects: released.length,
    retainedObjects: released.filter((ref) => ref.deref() !== undefined).length,
    hosts: hosts.childElementCount,
    pendingFrames: frames.size + inputLatency.pendingFrames(),
    active: active !== null,
  }
}

const inputLatency = createInputLatencyProbe({ current, expected: () => expected })

const bridge = {
  inputLatency,
  prepare,
  open,
  observe,
  verifyRows,
  jump,
  beginTyping,
  finishTyping,
  verifyText,
  churn,
  probeViews,
  finishProbe,
  revealHidden,
  dispose,
  retention,
  cancel: () => {
    cancelled = true
  },
}
globalThis.__stress = bridge
