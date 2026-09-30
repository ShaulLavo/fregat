import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core/document'
import { createMarkdownPreviewPlugin } from '@singapore-editor/markdown'
import '@singapore-editor/markdown/style.css'
import { Editor } from '@singapore-editor/core/editor'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { createError } from '@singapore-editor/core/logging/evlog'
import {
  createEmptySyntaxResult,
  type EditorSyntaxCapture,
  type EditorSyntaxResult,
  type EditorSyntaxSession,
} from '@singapore-editor/core/syntax'
import '@singapore-editor/core/style.css'

// E036 step 1: which geometry path each row takes on real-shaped files, and what the measured path
// costs a click, a caret move and a keystroke. `go-spaces` is `go-tabs` with each tab as 4 spaces.
export type GeometryFixture =
  | 'go-tabs'
  | 'go-spaces'
  | 'go-tabs-long'
  | 'go-spaces-long'
  | 'markdown'
  | 'unicode'
type Path = 'calculated' | 'inline-mapping' | 'non-simple-text' | 'tab'
type Diagnostic = { readonly name: string; readonly detail?: Readonly<Record<string, unknown>> }
type Counts = {
  builds: Record<Path, number>
  sweeps: number
  sweptBoundaries: number
  rectReads: number
}
type Event = { at: number; dispatchAt: number; appliedAt: number | null; frameAt: number | null }

const LINES = 3000
const hosts = document.querySelector<HTMLElement>('#views')!
let editor: Editor | null = null
let counts = emptyCounts()
let events: Event[] = []
let pending: Event | null = null
let released: WeakRef<object>[] = []

function check(value: unknown, message: string): asserts value {
  if (value) return
  throw createError({ message, status: 422, code: 'E036_GEOMETRY_WORKLOAD' })
}

function emptyCounts(): Counts {
  return {
    builds: { calculated: 0, 'inline-mapping': 0, 'non-simple-text': 0, tab: 0 },
    sweeps: 0,
    sweptBoundaries: 0,
    rectReads: 0,
  }
}

function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
}

function goFunction(index: number, random: () => number): string[] {
  const name = `handler${index}`
  const field = ['Items', 'Rows', 'Nodes', 'Entries'][random() % 4]
  return [
    `// ${name} validates every request item and collects the transformed results.`,
    `func ${name}(ctx context.Context, req *Request) (*Response, error) {`,
    '\tif req == nil {',
    '\t\treturn nil, errNilRequest',
    '\t}',
    `\tresult := make([]Item, 0, len(req.${field}))`,
    `\tfor i, item := range req.${field} {`,
    '\t\tif err := validate(ctx, item); err != nil {',
    `\t\t\treturn nil, fmt.Errorf("item %d of ${name}: %w", i, err)`,
    '\t\t}',
    `\t\tresult = append(result, transform(item, i*${random() % 97}))`,
    '\t}',
    '\treturn &Response{Items: result}, nil',
    '}',
    '',
  ]
}

// `long` pads every non-blank line with a trailing comment to about 180 columns, which is where a
// row sweep's cost, linear in boundaries, would show if it shows anywhere in ordinary code.
function goText(indent: string, long: boolean): string {
  const random = seeded(60061)
  const lines: string[] = ['package stress', '']
  for (let index = 0; lines.length < LINES; index++) lines.push(...goFunction(index, random))
  return lines
    .slice(0, LINES)
    .map((line) => (long && line ? padded(line) : line))
    .map((line) => line.replace(/^\t+/, (tabs) => indent.repeat(tabs.length)))
    .join('\n')
}

function padded(line: string): string {
  const comment = ' // keeps the row long enough that a sweep reads well over a hundred boundaries'
  return (line + comment + ' filler words'.repeat(8)).slice(0, 180)
}

function markdownText(): string {
  const random = seeded(60061)
  const lines: string[] = []
  for (let index = 0; lines.length < LINES; index++) {
    lines.push(`## Section ${index}`, '')
    lines.push(`Some **bold claim ${random() % 1000}** and plain prose that runs on for a while.`)
    lines.push(`A second line of prose with \`inline code\` and no replacement at all.`)
    lines.push(`Then **another bold** phrase, and **a third** one, before the paragraph ends.`)
    lines.push('')
  }
  return lines.slice(0, LINES).join('\n')
}

function unicodeText(): string {
  const random = seeded(60061)
  return Array.from(
    { length: LINES },
    (_, row) => `const value${row} = "日本語 é ${random() % 100} 😀 needle"; // ümlaut`,
  ).join('\n')
}

function fixtureText(fixture: GeometryFixture): string {
  if (fixture === 'go-tabs') return goText('\t', false)
  if (fixture === 'go-spaces') return goText('    ', false)
  if (fixture === 'go-tabs-long') return goText('\t', true)
  if (fixture === 'go-spaces-long') return goText('    ', true)
  if (fixture === 'markdown') return markdownText()
  return unicodeText()
}

// Markdown acts only on captures, so a structural session hands it every bold span in the text.
function markdownCaptures(text: string): EditorPlugin {
  const captures: EditorSyntaxCapture[] = []
  for (const match of text.matchAll(/\*\*[^*\n]+\*\*/g)) {
    const start = match.index
    const end = start + match[0].length
    captures.push(
      { captureName: 'text.strong', startIndex: start, endIndex: end },
      { captureName: 'punctuation.delimiter', startIndex: start, endIndex: start + 2 },
      { captureName: 'punctuation.delimiter', startIndex: end - 2, endIndex: end },
    )
  }
  const result = (): EditorSyntaxResult => ({ ...createEmptySyntaxResult(), captures })
  const session: EditorSyntaxSession = {
    refresh: async () => result(),
    applyChange: async () => result(),
    foldingSupport: 'supported',
    getResult: result,
    getTokens: () => [],
    getSnapshotVersion: () => 0,
    dispose() {},
  }
  return {
    activate: (context) => context.registerSyntaxProvider({ createSession: () => session }),
  }
}

function record(event: Diagnostic) {
  if (event.name === 'view.rowGeometry') {
    counts.builds[event.detail?.path as Path] += 1
    return
  }
  if (event.name !== 'view.rowGeometry.sweep') return
  counts.sweeps += 1
  counts.sweptBoundaries += Number(event.detail?.boundaries ?? 0)
}

function setDiagnosticSink(sink: ((event: Diagnostic) => void) | null) {
  ;(
    globalThis as { __EDITOR_PERFORMANCE_DIAGNOSTICS__?: unknown }
  ).__EDITOR_PERFORMANCE_DIAGNOSTICS__ = sink
}

function countRectReads() {
  const targets = [
    [Range.prototype, 'getClientRects'],
    [Range.prototype, 'getBoundingClientRect'],
    [Element.prototype, 'getBoundingClientRect'],
    [Element.prototype, 'getClientRects'],
  ] as const
  for (const [prototype, name] of targets) {
    const original = prototype[name] as (...args: unknown[]) => unknown
    Object.defineProperty(prototype, name, {
      configurable: true,
      value(this: unknown, ...args: unknown[]) {
        counts.rectReads += 1
        return original.apply(this, args)
      },
    })
  }
}

function markInput(event: globalThis.Event) {
  if (!event.isTrusted) return
  pending = { at: event.timeStamp, dispatchAt: performance.now(), appliedAt: null, frameAt: null }
  events.push(pending)
}

function applied() {
  const event = pending
  if (!event || event.appliedAt !== null) return
  event.appliedAt = performance.now()
  // @justification Benchmark observation of the first animation frame after an applied key; it
  // records a timestamp only and schedules no editor work.
  requestAnimationFrame(() => {
    event.frameAt = performance.now()
  })
}

function open(fixture: GeometryFixture, diagnostics: boolean, fontFamily?: string) {
  const text = fixtureText(fixture)
  counts = emptyCounts()
  setDiagnosticSink(diagnostics ? record : null)
  if (diagnostics) countRectReads()
  const host = document.createElement('section')
  host.id = 'view-0'
  host.style.cssText = 'width:900px;height:600px;position:relative;overflow:hidden;display:flex'
  if (fontFamily) host.style.setProperty('--e036-font', fontFamily)
  hosts.append(host)
  const buffer = createEditorTextBuffer(text)
  const start = performance.now()
  editor = new Editor(host, {
    lineHeight: 20,
    tabSize: 4,
    detectIndentation: false,
    plugins: fixture === 'markdown' ? [markdownCaptures(text), createMarkdownPreviewPlugin()] : [],
    onChange: () => applied(),
  })
  editor.attachSession(createEditorBufferSession(buffer), {
    documentId: `geometry.${fixture === 'markdown' ? 'md' : 'go'}`,
    languageId: fixture === 'markdown' ? 'markdown' : null,
  })
  released = [new WeakRef(buffer), new WeakRef(editor)]
  for (const type of ['pointerdown', 'keydown'])
    window.addEventListener(type, markInput, { capture: true })
  return { length: text.length, lines: LINES, openMs: performance.now() - start }
}

/** The mounted rows, classified the way `rowGeometryPath` classifies them. */
function rowMix(): Record<Path, number> {
  const mix: Record<Path, number> = {
    calculated: 0,
    'inline-mapping': 0,
    'non-simple-text': 0,
    tab: 0,
  }
  for (const row of document.querySelectorAll<HTMLElement>('#view-0 .editor-virtualized-row')) {
    if (row.classList.contains('editor-inline-marker')) {
      mix['inline-mapping'] += 1
      continue
    }
    mix[classify(rowText(row))] += 1
  }
  return mix
}

const LAYERS =
  '.editor-virtualized-selection-layer,.editor-virtualized-hidden-character-layer,' +
  '.editor-virtualized-fold-placeholder,.editor-virtualized-gutter-row'

function rowText(row: HTMLElement): string {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  let text = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(LAYERS)) continue
    text += node.nodeValue ?? ''
  }
  return text
}

function classify(text: string): Path {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code !== 9 && (code < 32 || code > 126)) return 'non-simple-text'
  }
  return text.includes('\t') ? 'tab' : 'calculated'
}

/**
 * Candidate 2: asks the editor which offset sits under the left edge of every character, read from
 * the DOM, on rows whose text is a single node. A monospace font answers every column exactly.
 */
function hitTestErrors() {
  check(editor, 'No open document')
  let checked = 0
  let wrong = 0
  let maxColumnError = 0
  for (const row of document.querySelectorAll<HTMLElement>('#view-0 .editor-virtualized-row')) {
    const node = Array.from(row.childNodes).find((child) => child.nodeType === Node.TEXT_NODE)
    const text = node?.nodeValue ?? ''
    if (!node || text.length < 8 || classify(text) !== 'calculated') continue
    const range = document.createRange()
    const rowRect = row.getBoundingClientRect()
    const y = rowRect.top + rowRect.height / 2
    const start = editor.rowAtPoint(rowRect.left + 0.5, y)?.offset
    if (start == null) continue
    for (let column = 1; column < text.length; column += 3) {
      range.setStart(node, column)
      range.setEnd(node, column + 1)
      const hit = editor.rowAtPoint(range.getBoundingClientRect().left + 1, y)?.offset
      if (hit == null) continue
      checked += 1
      const error = Math.abs(hit - start - column)
      if (error) wrong += 1
      maxColumnError = Math.max(maxColumnError, error)
    }
  }
  return { checked, wrong, maxColumnError }
}

/** What a Monaco-style monospace probe costs: `|/-_ilm%` and digits in three styles. */
function monospaceProbeCost(fontFamily: string, repetitions = 200) {
  const probe = document.createElement('div')
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-family:${fontFamily}`
  document.body.append(probe)
  const samples = '|/-_ilm%0123456789'.split('')
  const styles = ['normal', 'italic', 'bold']
  const spans = styles.flatMap((style) =>
    samples.map((sample) => {
      const span = document.createElement('span')
      span.textContent = sample.repeat(16)
      if (style === 'italic') span.style.fontStyle = 'italic'
      if (style === 'bold') span.style.fontWeight = 'bold'
      probe.append(span, document.createElement('br'))
      return span
    }),
  )
  let monospace = true
  const start = performance.now()
  for (let repetition = 0; repetition < repetitions; repetition++) {
    probe.style.letterSpacing = repetition % 2 ? '0px' : '0.0001px'
    const widths = spans.map((span) => span.getBoundingClientRect().width / 16)
    monospace = widths.every((width) => Math.abs(width - widths[0]!) < 0.001)
  }
  const perProbeMs = (performance.now() - start) / repetitions
  probe.remove()
  return { perProbeMs, monospace, reads: spans.length }
}

/** Client points of the mounted text rows, for the runner to click. */
function rowPoints() {
  const rows = document.querySelectorAll<HTMLElement>('#view-0 .editor-virtualized-row')
  return Array.from(rows, (row) => {
    const rect = row.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, left: rect.left }
  }).filter((rect) => rect.top >= 0 && rect.bottom <= 600)
}

function begin() {
  counts = emptyCounts()
  events = []
  pending = null
}

function take() {
  const taken = { counts, events }
  counts = emptyCounts()
  events = []
  pending = null
  return taken
}

function settle() {
  // @justification Benchmark settle between phases: it only resolves the awaited promise, so
  // deferred editor work finishes before counts are taken.
  return new Promise<void>((resolve) => setTimeout(resolve, 200))
}

function dispose() {
  check(editor, 'No open document')
  for (const type of ['pointerdown', 'keydown'])
    window.removeEventListener(type, markInput, { capture: true })
  editor.dispose()
  editor = null
  hosts.replaceChildren()
  setDiagnosticSink(null)
}

function retained() {
  return released.filter((reference) => reference.deref()).length
}

declare global {
  var __geometry: {
    open: typeof open
    hitTestErrors: typeof hitTestErrors
    monospaceProbeCost: typeof monospaceProbeCost
    rowMix: typeof rowMix
    rowPoints: typeof rowPoints
    begin: typeof begin
    take: typeof take
    settle: typeof settle
    dispose: typeof dispose
    retained: typeof retained
  }
}

globalThis.__geometry = {
  open,
  hitTestErrors,
  monospaceProbeCost,
  rowMix,
  rowPoints,
  begin,
  take,
  settle,
  dispose,
  retained,
}
