import type { Editor } from '@singapore-editor/core/editor'
import { pointToOffset, type EditorTextBuffer } from '@singapore-editor/core/document'
import { createError } from '@singapore-editor/core/logging/evlog'
import { verifyRenderedText } from './inputRenderedText.ts'

export type InputScenario =
  | 'typing'
  | 'repeat'
  | 'composition-update'
  | 'composition-commit'
  | 'paste'
  | 'undo'

type Sample = {
  readonly id: number
  readonly eventType: string
  readonly inputType: string | null
  readonly at: number
  readonly dispatchAt: number
  readonly revisionBefore: number
  readonly trusted: boolean
  readonly repeat: boolean
  completedAt: number | null
  appliedAt: number | null
  frameAt: number | null
  revisionAfter: number | null
}
type Document = { readonly buffer: EditorTextBuffer; readonly editors: readonly Editor[] }
type Options = {
  readonly current: () => Document
  readonly expected: () => string
}
const capacity = 2048

export function createInputLatencyProbe(options: Options) {
  let samples: Sample[] = []
  let active: Sample | null = null
  let abort: AbortController | null = null
  const frames = new Set<number>()
  let scenario: InputScenario = 'typing'
  let slowdownMs = 0
  let offset = 0
  let enabled = false
  let initialRevision = 0
  let repeated = false
  let expectedAfter = ''

  function matches(event: Event): boolean {
    if (!enabled) return false
    if (scenario === 'paste') return event.type === 'paste'
    if (scenario === 'composition-update') return event.type === 'compositionupdate'
    if (scenario === 'composition-commit') return event.type === 'compositionend'
    if (scenario === 'undo') return event instanceof KeyboardEvent && event.key === 'z'
    return (
      event instanceof InputEvent &&
      event.type === 'beforeinput' &&
      event.inputType === 'insertText'
    )
  }

  function capture(event: Event) {
    if (event instanceof KeyboardEvent) repeated = event.repeat
    if (!matches(event)) return
    check(samples.length < capacity, 'Input diagnostic buffer overflow')
    const sample: Sample = {
      id: samples.length + 1,
      eventType: event.type,
      inputType: event instanceof InputEvent ? event.inputType : event.type,
      at: event.timeStamp,
      dispatchAt: performance.now(),
      revisionBefore: options.current().buffer.getRevision(),
      trusted: event.isTrusted,
      repeat: repeated,
      completedAt: null,
      appliedAt: null,
      frameAt: null,
      revisionAfter: null,
    }
    active = sample
    samples.push(sample)
  }

  function finishDispatch(sample: Sample) {
    if (!enabled) return
    sample.completedAt = performance.now()
    sample.revisionAfter = options.current().buffer.getRevision()
    if (scenario === 'composition-update') sample.appliedAt = sample.completedAt
    const frame = requestAnimationFrame(() => {
      sample.frameAt = performance.now()
      frames.delete(frame)
    })
    frames.add(frame)
    if (active === sample) active = null
  }

  function applied() {
    if (!enabled || !active || active.appliedAt !== null) return
    active.appliedAt = performance.now()
    const sample = active
    queueMicrotask(() => finishDispatch(sample))
    delayControl()
  }

  function delayControl() {
    const until = performance.now() + slowdownMs
    while (performance.now() < until) {
      /* Delayed control runs after the applied-edit mark. */
    }
  }

  function finishPreedit(event: Event) {
    if (scenario !== 'composition-update' || !matches(event) || !active) return
    delayControl()
    finishDispatch(active)
  }

  function prepare(input: InputScenario, delayMs: number) {
    dispose()
    scenario = input
    slowdownMs = delayMs
    const { editors, buffer } = options.current()
    const row = Math.min(8, options.expected().split('\n').length - 1)
    offset = pointToOffset(buffer.getSnapshot(), { row, column: 0 })
    editors[0]!.setSelection(offset, offset, { reveal: true })
    editors[0]!.focus()
    initialRevision = buffer.getRevision()
    abort = new AbortController()
    for (const type of ['keydown', 'beforeinput', 'compositionupdate', 'compositionend', 'paste'])
      window.addEventListener(type, capture, { capture: true, signal: abort.signal })
    window.addEventListener('compositionupdate', finishPreedit, { signal: abort.signal })
    return { row, offset }
  }

  function seedUndo(count: number) {
    const editor = options.current().editors[0]!
    for (let index = 0; index < count; index++)
      editor.edit(
        { from: offset + index, to: offset + index, text: 'x' },
        { history: 'record', selection: { anchor: offset + index + 1 } },
      )
  }

  function start() {
    samples = []
    active = null
    repeated = false
    enabled = true
  }

  function finish(inserted: string, expectedCount: number) {
    enabled = false
    const { editors, buffer } = options.current()
    const source = options.expected()
    const expected = source.slice(0, offset) + inserted + source.slice(offset)
    expectedAfter = expected
    check(
      samples.length === expectedCount,
      `Expected ${expectedCount} ${scenario} events, observed ${samples.length}`,
    )
    check(
      samples.every(
        (sample) =>
          sample.trusted === (scenario !== 'composition-commit') &&
          sample.appliedAt !== null &&
          sample.completedAt !== null &&
          sample.frameAt !== null,
      ),
      `Missing native ${scenario} phase: ${JSON.stringify(samples)}`,
    )
    check(buffer.materializeFullText() === expected, `${scenario} produced incorrect document text`)
    for (const editor of editors)
      check(editor.materializeFullText() === expected, 'A peer view missed an input edit')
    const cursor = editors[0]!.getState().cursor
    const cursorOffset = pointToOffset(buffer.getSnapshot(), cursor)
    check(
      cursorOffset === offset + inserted.length,
      `${scenario} produced incorrect cursor offset ${cursorOffset}`,
    )
    check(
      scenario !== 'repeat' || samples.slice(1).every((sample) => sample.repeat),
      'Repeated keydown lost the repeat flag',
    )
    return {
      events: samples,
      cursor,
      offset,
      revision: buffer.getRevision(),
      initialRevision,
      views: editors.length,
    }
  }

  function verifyRendered() {
    const lines = expectedAfter.split('\n')
    return options.current().editors.map((_editor, view) => {
      const host = document.querySelector<HTMLElement>(`#view-${view}`)!
      if (host.hidden) return { view, hidden: true, rows: 0, chunks: 0 }
      return { view, hidden: false, ...verifyMountedRows(host, lines) }
    })
  }

  function revealHidden() {
    const { editors } = options.current()
    if (editors.length !== 3) return
    const host = document.querySelector<HTMLElement>('#view-2')!
    host.hidden = false
    host.style.display = 'flex'
    editors[2]!.setSelection(offset, offset, { reveal: true })
  }

  function dispose() {
    enabled = false
    abort?.abort()
    abort = null
    for (const frame of frames) cancelAnimationFrame(frame)
    frames.clear()
    samples = []
    active = null
    expectedAfter = ''
  }

  return {
    prepare,
    seedUndo,
    start,
    finish,
    verifyRendered,
    revealHidden,
    applied,
    dispose,
    pendingFrames: () => frames.size,
  }
}

function verifyMountedRows(host: HTMLElement, lines: readonly string[]) {
  const rows = [...host.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')]
  check(rows.length > 0, 'Visible editor has no text rows')
  const chunks = rows.reduce((count, row) => count + verifyRow(row, lines), 0)
  return { rows: rows.length, chunks, verifiedText: true }
}

function verifyRow(row: HTMLElement, lines: readonly string[]): number {
  const expected = lines[Number(row.dataset.editorVirtualRow)]
  check(expected !== undefined, 'Rendered row outside document')
  const chunks = [...row.querySelectorAll<HTMLElement>('[data-editor-virtual-chunk-start]')]
  if (row.dataset.editorVirtualWindowStart === undefined) {
    check(chunks.length === 0, 'Chunked row has no declared window')
    return verifyRenderedText({ kind: 'direct', text: row.textContent ?? '' }, expected)
  }
  return verifyRenderedText(
    {
      kind: 'chunked',
      start: Number(row.dataset.editorVirtualWindowStart),
      end: Number(row.dataset.editorVirtualWindowEnd),
      chunks: chunks.map((chunk) => ({
        start: Number(chunk.dataset.editorVirtualChunkStart),
        end: Number(chunk.dataset.editorVirtualChunkEnd),
        text: chunk.textContent ?? '',
      })),
    },
    expected,
  )
}

function check(value: unknown, message: string): asserts value {
  if (value) return
  throw createError({
    message,
    status: 422,
    code: 'INPUT_LATENCY_INVALID',
    why: 'Native input did not meet the benchmark contract.',
    fix: 'Inspect the event phases and document state.',
  })
}
