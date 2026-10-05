import { observeWorkerTransport } from './workerObservation'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import {
  Editor,
  createEditorPreparedDocument,
  type EditorInitialPaintEvent,
  type EditorPreparedDocument,
} from '@singapore-editor/core/editor'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  type EditorTextBuffer,
} from '@singapore-editor/core/document'
import { createError } from '@singapore-editor/core/logging/evlog'
import {
  createTreeSitterSyntaxPlugin,
  createTreeSitterSyntaxProvider,
  createTreeSitterWorkerOwner,
  type TreeSitterWorkerOwner,
  type TreeSitterSyntaxProvider,
} from '@singapore-editor/tree-sitter'
import { TYPESCRIPT_TREE_SITTER_LANGUAGE } from '@singapore-editor/tree-sitter-languages'
import '@singapore-editor/core/style.css'
import { createFoldGutterPlugin } from '../../../packages/gutters/dist/index.js'
import '../../../packages/gutters/dist/style.css'
import { generateFallbackFixture } from './fallbackFixture.ts'
import { fixtureFacts, generateFixture, type FixtureId } from './fixtures.ts'

type Configuration = {
  readonly fixture: FixtureId
  readonly seed: number
  readonly prepared: boolean
  readonly plugin: boolean
  readonly diagnostics: boolean
  readonly fallbackCases: boolean
  readonly foldGutter: boolean
}
type Diagnostic = {
  readonly name: string
  readonly durationMs?: number
  readonly detail?: Readonly<Record<string, unknown>>
}
type Paint = EditorInitialPaintEvent & { readonly at: number }
type InputMeasurement = { at: number; appliedAt: number | null; frameAt: number | null }

let configuration: Configuration
let source = ''
let buffer: EditorTextBuffer | null = null
let editor: Editor | null = null
let prepared: EditorPreparedDocument | null = null
let provider: TreeSitterSyntaxProvider | null = null
let worker: TreeSitterWorkerOwner | null = null
let paints: Paint[] = []
let diagnostics: (Diagnostic & { readonly at: number })[] = []
let stopWorkerObservation: (() => void) | null = null
let droppedDiagnostics = 0
let preparationMs = 0
let bufferMs = 0
let start = 0
let inputMeasurements: InputMeasurement[] = []
let inputOffset: number | null = null
let retained: { readonly label: string; readonly reference: WeakRef<object> }[] = []

function check(value: unknown, message: string): asserts value {
  if (value) return
  throw createError({
    message,
    code: 'FIRST_PAINT_CORRECTNESS',
    status: 422,
    why: 'The benchmark did not observe the expected document.',
    fix: 'Inspect the sample state, paint events, and asset timeline.',
  })
}

async function phase<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (!configuration.diagnostics) return run()
  const at = performance.now()
  try {
    return await run()
  } finally {
    diagnostics.push({ name, at, durationMs: performance.now() - at })
  }
}

function syntaxProvider(): TreeSitterSyntaxProvider {
  if (provider) return provider
  worker = createTreeSitterWorkerOwner()
  provider = createTreeSitterSyntaxProvider({ workerOwner: worker })
  const load = TYPESCRIPT_TREE_SITTER_LANGUAGE.load
  check(load, 'The TypeScript contribution must load real language assets')
  provider.registerLanguage({
    ...TYPESCRIPT_TREE_SITTER_LANGUAGE,
    load: () => phase('startup.language.assets', load),
  })
  return provider
}

function createBuffer(): EditorTextBuffer {
  const at = performance.now()
  const created = createEditorTextBuffer(source)
  bufferMs = performance.now() - at
  return created
}

async function configure(options: Configuration) {
  dispose()
  configuration = options
  source = options.fallbackCases
    ? generateFallbackFixture(options.fixture, options.seed)
    : generateFixture(options.fixture, options.seed)
  paints = []
  diagnostics = []
  if (!stopWorkerObservation) {
    stopWorkerObservation = observeWorkerTransport(
      (event) => {
        if (event.durationMs === undefined || !configuration.diagnostics) return
        recordDiagnostic({
          name: `startup.worker.transport.${event.type}`,
          durationMs: event.durationMs,
          detail: { boundary: 'postMessage-to-reply' },
        })
      },
      () => configuration.diagnostics,
    )
    globalThis.addEventListener('pagehide', () => stopWorkerObservation?.(), { once: true })
  }
  droppedDiagnostics = 0
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = options.diagnostics ? recordDiagnostic : null
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  const facts = {
    ...fixtureFacts(source),
    sha256: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  }
  preparationMs = 0
  bufferMs = 0
  if (!options.prepared) return facts
  const at = performance.now()
  buffer = createBuffer()
  prepared = createEditorPreparedDocument({
    buffer,
    analysis: createEditorDocumentAnalysis({ buffer, documentId: options.fixture }),
    documentId: options.fixture,
    languageId: options.plugin ? 'typescript' : null,
    configuredTabSize: 4,
    tabSizePolicy: 'fixed',
    documentConfigurationTag: [],
  })
  if (options.plugin) await prepareSyntax(prepared, buffer)
  await prepared.fallbackReady
  preparationMs = performance.now() - at
  return facts
}

async function prepareSyntax(document: EditorPreparedDocument, textBuffer: EditorTextBuffer) {
  const outcome = await document.startStage({
    family: 'structural',
    provider: syntaxProvider(),
    configuration: { includeCaptures: false, includeHighlights: true, syntaxMode: 'range' },
    configurationTag: [],
    range: { startIndex: 0, endIndex: Math.min(4096, textBuffer.getSnapshot().length) },
    abortSignal: new AbortController().signal,
  })
  check(outcome === 'ready', `Prepared syntax ended in ${outcome}`)
}

function recordDiagnostic(event: Diagnostic) {
  if (diagnostics.length >= 8192) {
    droppedDiagnostics++
    return
  }
  diagnostics.push({ ...event, at: performance.now() })
}

function open() {
  start = performance.now()
  buffer ??= createBuffer()
  const host = document.createElement('section')
  host.id = 'view-0'
  Object.assign(host.style, {
    width: '900px',
    height: '320px',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
  })
  document.querySelector('#views')!.append(host)
  const plugins = configuration.plugin ? [createTreeSitterSyntaxPlugin(syntaxProvider())] : []
  if (configuration.foldGutter) plugins.push(createFoldGutterPlugin())
  const constructorAt = performance.now()
  editor = new Editor(host, {
    lineHeight: 20,
    tabSize: 4,
    detectIndentation: false,
    plugins,
    onInitialPaint: (event) => paints.push({ ...event, at: performance.now() }),
    onChange: inputApplied,
  })
  editor.getInputElement().addEventListener('beforeinput', beforeInput, { capture: true })
  const constructedAt = performance.now()
  editor.attachSession(createEditorBufferSession(buffer), {
    documentId: configuration.fixture,
    languageId: configuration.plugin ? 'typescript' : null,
    preparedDocument: prepared,
    documentConfigurationTag: [],
    structuralConfigurationTag: [],
  })
  const attachedAt = performance.now()
  return { start, constructorAt, constructedAt, attachedAt, bufferMs, preparationMs }
}

function observe() {
  check(editor && buffer, 'No document is open')
  const rows = [...document.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')]
  return {
    now: performance.now(),
    start,
    paints,
    diagnostics,
    droppedDiagnostics,
    state: editor.getState(),
    revision: buffer.getRevision(),
    correctText: editor.materializeFullText() === source,
    rows: rows.map((row) => ({ row: Number(row.dataset.editorVirtualRow), text: row.textContent })),
    worker: worker?.inspect() ?? null,
  }
}

function foldCommand(command: 'fold' | 'foldAll' | 'unfoldAll') {
  check(editor && buffer, 'No document is open')
  const at = performance.now()
  const changed = command === 'fold' ? editor.fold(0) : editor[command]()
  return { command, at, durationMs: performance.now() - at, changed }
}

function beginEditBurst() {
  check(editor && buffer, 'No document is open')
  const offset = source.indexOf('\n', source.indexOf('\n') + 1) + 8
  editor.setSelection(offset, offset, { reveal: true })
  editor.focus()
  inputMeasurements = []
  inputOffset = offset
}

function beforeInput(event: InputEvent) {
  if (inputOffset === null || event.inputType !== 'insertText') return
  inputMeasurements.push({ at: performance.now(), appliedAt: null, frameAt: null })
}

function inputApplied() {
  const input = inputMeasurements.at(-1)
  if (inputOffset === null || !input || input.appliedAt !== null) return
  input.appliedAt = performance.now()
  // @justification Measures the next input frame; each benchmark burst waits for it before disposal.
  requestAnimationFrame(() => {
    input.frameAt = performance.now()
  })
}

function finishEditBurst() {
  check(buffer && inputOffset !== null, 'No input burst is active')
  check(inputMeasurements.length === 12, 'Expected twelve real beforeinput events')
  const offset = inputOffset
  inputOffset = null
  const events = inputMeasurements.map((input) => {
    check(input.appliedAt !== null && input.frameAt !== null, 'Input did not apply and paint')
    return { at: input.at, appliedAt: input.appliedAt, frameAt: input.frameAt }
  })
  source = source.slice(0, offset) + 'x'.repeat(12) + source.slice(offset)
  return { events, offset, revision: buffer.getRevision() }
}

function dispose() {
  retained = [
    { label: 'editor', value: editor },
    { label: 'buffer', value: buffer },
    { label: 'prepared', value: prepared },
  ].flatMap(({ label, value }) => (value ? [{ label, reference: new WeakRef(value) }] : []))
  editor?.dispose()
  prepared?.dispose()
  prepared?.analysis.dispose()
  editor = null
  buffer = null
  prepared = null
  document.querySelector('#views')!.replaceChildren()
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = null
  source = ''
  inputOffset = null
  inputMeasurements = []
}

function retention() {
  return {
    retainedObjects: retained.filter((value) => value.reference.deref() !== undefined).length,
    retainedLabels: retained
      .filter((value) => value.reference.deref() !== undefined)
      .map((value) => value.label),
    hosts: document.querySelector('#views')!.childElementCount,
    active: editor !== null,
    worker: worker?.inspect() ?? null,
  }
}

const firstPaint = {
  configure,
  open,
  observe,
  foldCommand,
  beginEditBurst,
  finishEditBurst,
  dispose,
  retention,
  status: () => editor?.getState(),
  settleDisposal: () => worker?.awaitIdleFence(),
  fallbackObservedAfter: (at: number) =>
    diagnostics.some((event) => event.name === 'editor.fallbackFoldRanges' && event.at >= at),
}
declare global {
  var __firstPaint: typeof firstPaint
}
globalThis.__firstPaint = firstPaint
