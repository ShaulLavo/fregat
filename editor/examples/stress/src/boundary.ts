import { createEditorStructuralOperation } from '@singapore-editor/core/editor'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  type EditorTextBuffer,
} from '@singapore-editor/core/document'
import { createMergeConflictPlugin, Editor } from '@singapore-editor/core/editor'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { createError } from '@singapore-editor/core/logging/evlog'
import {
  createEmptySyntaxResult,
  type EditorSyntaxCapture,
  type EditorSyntaxResult,
  type EditorSyntaxRuntime,
} from '@singapore-editor/core/syntax'
import { createDecodePlugin } from '@singapore-editor/decode'
import { createMinimapPlugin } from '@singapore-editor/minimap'
import '@singapore-editor/minimap/style.css'
import '@singapore-editor/decode/style.css'
import { createMarkdownPreviewPlugin } from '@singapore-editor/markdown'
import '@singapore-editor/markdown/style.css'
import { createScopeLinesPlugin } from '@singapore-editor/scope-lines'
import '@singapore-editor/scope-lines/style.css'
import '@singapore-editor/core/style.css'
import { createInputLatencyProbe } from './inputLatency.ts'

// E033's workload: fixed content above a filler whose length alone grows, so every size shows the
// same viewport, captures, caret and conflict. The probe types on row 8, inside the conflict.
export type BoundaryConfig = 'plain' | 'contributions' | 'minimap' | 'folds'

type Diagnostic = { readonly name: string; readonly detail?: Readonly<Record<string, unknown>> }
type Reads = { fullReads: number; units: number; chunkWalks: number }

const HEAD = [
  '# Title',
  '',
  'Some **bold** prose and more.',
  '',
  '<<<<<<< ours',
  'ours line one',
  'ours line two',
  'ours line three',
  'ours line four',
  '=======',
  'theirs line',
  '>>>>>>> theirs',
  'function outer() {',
  '  if (ready) {',
  '    return 1',
  '  }',
  '}',
  '',
].join('\n')
const BOLD = HEAD.indexOf('**bold**')
const FILLER = 'filler line of plain text\n'
const INDENTED_FILLER = 'function value() {\n  return 123\n}\n'
const REPLACEMENTS = 32

let source = ''
let active: { buffer: EditorTextBuffer; editors: Editor[] } | null = null
let released: WeakRef<object>[] = []
let reads: Reads = { fullReads: 0, units: 0, chunkWalks: 0 }
const hosts = document.querySelector<HTMLElement>('#views')!

function record(event: Diagnostic) {
  if (event.name !== 'textSnapshot.read') return
  const detail = event.detail ?? {}
  reads.units += Number(detail.sourceBytesRead ?? 0) / 2
  reads.fullReads += Number(detail.fullTextReads ?? 0)
  if (detail.fullTextReads && detail.materializedStrings !== 1) reads.chunkWalks += 1
}

function setDiagnosticSink(sink: ((event: Diagnostic) => void) | null) {
  ;(
    globalThis as { __EDITOR_PERFORMANCE_DIAGNOSTICS__?: unknown }
  ).__EDITOR_PERFORMANCE_DIAGNOSTICS__ = sink
}

function check(value: unknown, message: string): asserts value {
  if (value) return
  throw createError({ message, status: 422, code: 'E033_BOUNDARY_WORKLOAD' })
}

/** A document of `size` units: the fixed head, then filler rewritten by 32 real replacements. */
function fragmentedBuffer(size: number, config: BoundaryConfig): EditorTextBuffer {
  const filler = config === 'minimap' || config === 'folds' ? INDENTED_FILLER : FILLER
  const lines = Math.floor((size - HEAD.length) / filler.length)
  source = `${HEAD}${filler.repeat(lines)}`
  const buffer = createEditorTextBuffer(source)
  const session = createEditorBufferSession(buffer)
  const stride = Math.floor((source.length - HEAD.length) / REPLACEMENTS)
  for (let index = 0; index < REPLACEMENTS; index++) {
    const from = HEAD.length + index * stride + 1
    session.applyEdits([{ from, to: from + 1, text: 'I' }], { history: 'skip' })
    source = `${source.slice(0, from)}I${source.slice(from + 1)}`
  }
  return buffer
}

// Markdown acts only on captures, so a structural session hands it a fixed set. The session answers
// every refresh shape either editor build asks with, which is why it ignores its arguments.
function markdownCaptures(): EditorPlugin {
  const captures: EditorSyntaxCapture[] = [
    { captureName: 'text.strong', startIndex: BOLD, endIndex: BOLD + 8 },
    { captureName: 'punctuation.delimiter', startIndex: BOLD, endIndex: BOLD + 2 },
    { captureName: 'punctuation.delimiter', startIndex: BOLD + 6, endIndex: BOLD + 8 },
  ]
  const result = (): EditorSyntaxResult => ({ ...createEmptySyntaxResult(), captures })
  const session: EditorSyntaxRuntime = {
    analyze: async () => result(),
    foldingSupport: 'supported',
    getResult: result,
    getTokens: () => [],
    getSnapshotVersion: () => 0,
    dispose() {},
  }
  return {
    activate: (context) =>
      context.registerSyntaxProvider({ operation: createEditorStructuralOperation(() => session) }),
  }
}

function plugins(config: BoundaryConfig): EditorPlugin[] {
  if (config === 'plain' || config === 'folds') return []
  if (config === 'minimap') return [createMinimapPlugin()]
  return [
    markdownCaptures(),
    createMarkdownPreviewPlugin(),
    createScopeLinesPlugin(),
    createDecodePlugin(),
    createMergeConflictPlugin(),
  ]
}

function createHost(index: number): HTMLElement {
  const host = document.createElement('section')
  host.id = `view-${index}`
  host.style.cssText = 'width:900px;height:320px;position:relative;overflow:hidden;display:flex'
  hosts.append(host)
  return host
}

function open(size: number, config: BoundaryConfig, diagnostics: boolean, viewCount = 2) {
  reads = { fullReads: 0, units: 0, chunkWalks: 0 }
  setDiagnosticSink(diagnostics ? record : null)
  const buffer = fragmentedBuffer(size, config)
  const start = performance.now()
  const editors: Editor[] = []
  active = { buffer, editors }
  for (let index = 0; index < viewCount; index++) {
    const editor = new Editor(createHost(index), {
      lineHeight: 20,
      tabSize: 2,
      detectIndentation: false,
      plugins: plugins(config),
      onChange: (_state, change) => {
        if (index === 0 && change && change.kind !== 'selection' && change.kind !== 'none')
          probe.applied()
      },
    })
    editors.push(editor)
    editor.attachSession(createEditorBufferSession(buffer), {
      documentId: 'boundary.md',
      languageId: config === 'contributions' ? 'markdown' : null,
    })
  }
  return { length: source.length, openMs: performance.now() - start, reads: takeReads() }
}

/** The text a sample ended with becomes the text the next one starts from. */
function advance(inserted: string, offset: number) {
  source = `${source.slice(0, offset)}${inserted}${source.slice(offset)}`
}

function exportText() {
  check(active, 'No open document')
  const start = performance.now()
  const text = active.editors[0]!.materializeFullText()
  const exportMs = performance.now() - start
  check(text === source, 'Export differs from the document')
  return { exportMs, reads: takeReads() }
}

function takeReads(): Reads {
  const taken = reads
  reads = { fullReads: 0, units: 0, chunkWalks: 0 }
  return taken
}

function settle() {
  // @justification Benchmark settle between phases: it only resolves the awaited promise, so
  // deferred editor work finishes before reads are counted.
  return new Promise<void>((resolve) => setTimeout(resolve, 300))
}

function dispose() {
  probe.dispose()
  if (!active) return
  released = [new WeakRef(active.buffer), ...active.editors.map((editor) => new WeakRef(editor))]
  for (const editor of active.editors) editor.dispose()
  hosts.replaceChildren()
  active = null
  source = ''
  setDiagnosticSink(null)
}

function retained() {
  return released.filter((reference) => reference.deref()).length
}

const probe = createInputLatencyProbe({
  current: () => {
    check(active, 'No open document')
    return active
  },
  expected: () => source,
})

declare global {
  var __boundary: {
    open: typeof open
    probe: typeof probe
    advance: typeof advance
    exportText: typeof exportText
    takeReads: typeof takeReads
    settle: typeof settle
    dispose: typeof dispose
    retained: typeof retained
  }
}

globalThis.__boundary = {
  open,
  probe,
  advance,
  exportText,
  takeReads,
  settle,
  dispose,
  retained,
}
