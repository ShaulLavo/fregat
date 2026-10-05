import { createEditorTextBuffer, createEditorBufferSession } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import {
  createShikiWorkerOwner,
  createShikiHighlighterProvider,
} from '@singapore-editor/core/shiki'
import { observeWorkerTransport } from './workerObservation'
import { createError } from '@singapore-editor/core/logging/evlog'

type Diagnostic = { readonly name: string; readonly detail?: Readonly<Record<string, unknown>> }
type Sample = {
  readonly operation: string
  readonly durationMs: number
  readonly fullReads: number
  readonly fullReadUnits: number
  readonly wireUnits: number
  readonly heapAtRequest: number
}
let active: Awaited<ReturnType<typeof setup>> | null = null
let reads = { count: 0, units: 0 }
let wireUnits = 0
let heapAtRequest = 0
let released: WeakRef<object>[] = []

function check(value: unknown, message: string): asserts value {
  if (value) return
  throw createError({ message, status: 422, code: 'E007_COPY_PROOF' })
}

function diagnostic(event: Diagnostic) {
  if (event.name !== 'textSnapshot.materializeFullText' && event.name !== 'textSnapshot.readRange')
    return
  reads.count++
  reads.units += Number(event.detail?.textLength ?? event.detail?.length ?? 0)
}

async function setup(size: number, instrumented: boolean) {
  // A trivial real grammar isolates document transport from regex grammar cost.
  const language = { name: 'copy-proof', scopeName: 'source.copy-proof', patterns: [] }
  const theme = {
    name: 'copy-proof',
    settings: [{ settings: { foreground: '#ffffff', background: '#000000' } }],
  }
  const owner = createShikiWorkerOwner()
  const stopObservation = observeWorkerTransport((event) => {
    if (event.durationMs !== undefined) return
    heapAtRequest = Math.max(heapAtRequest, performance.memory.usedJSHeapSize)
    wireUnits += event.sourceUnits
  })
  const buffer = createEditorTextBuffer(
    `${'x'.repeat(4095)}\n`.repeat(Math.ceil(size / 4096)).slice(0, size),
  )
  const view = createEditorBufferSession(buffer)
  for (let index = 1; index <= 32; index++) {
    const offset = Math.floor((size * index) / 33)
    view.applyEdits([{ from: offset, to: offset + 1, text: 'y' }], { history: 'skip' })
  }
  const provider = createShikiHighlighterProvider({
    workerOwner: owner,
    resolveLanguage: async () => [language],
    resolveTheme: async () => theme,
  })
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'copy-proof' })
  const session = analysis.borrowHighlighter({ provider, languageId: 'copy-proof' })
  check(session, 'Shiki session was not created')
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = instrumented ? diagnostic : null
  const open = await measure('open', () => session.refresh(buffer.getTextSnapshot()))
  return { owner, session, buffer, view, open, provider, analysis, stopObservation }
}

async function measure(operation: string, run: () => Promise<unknown>): Promise<Sample> {
  reads = { count: 0, units: 0 }
  wireUnits = 0
  heapAtRequest = 0
  const started = performance.now()
  await run()
  return {
    operation,
    durationMs: performance.now() - started,
    fullReads: reads.count,
    fullReadUnits: reads.units,
    wireUnits,
    heapAtRequest,
  }
}

async function run(repetitions: number) {
  check(active, 'No active session')
  const { session, buffer, view } = active
  const samples: Sample[] = []
  for (let index = 0; index < repetitions; index++) {
    const before = active.buffer.getTextSnapshot()
    const first = { from: before.length - 9, to: before.length - 9, text: 'a' }
    const last = { from: before.length + 1 - 8, to: before.length + 1 - 8, text: 'b' }
    samples.push(
      await measure('skipped-edit', async () => {
        view.applyEdits([first])
        view.applyEdits([last])
        await session.refresh(buffer.getTextSnapshot())
      }),
    )
    samples.push(
      await measure('undo-branch', async () => {
        view.undo()
        view.undo()
        await session.refresh(buffer.getTextSnapshot())
      }),
    )
    samples.push(
      await measure('incremental', async () => {
        view.applyEdits([first])
        await session.refresh(buffer.getTextSnapshot())
      }),
    )
  }
  await verifyTokens()
  return samples
}

async function verifyTokens() {
  check(active, 'No active session')
  const { buffer, provider, owner, session } = active
  const reference = createEditorTextBuffer(buffer.materializeFullText())
  const analysis = createEditorDocumentAnalysis({ buffer: reference, documentId: 'reference' })
  const fresh = analysis.borrowHighlighter({ provider, languageId: 'copy-proof' })
  check(fresh, 'Reference session was not created')
  try {
    const expected = await fresh.refresh(reference.getTextSnapshot())
    const actual = await session.refresh(buffer.getTextSnapshot())
    check(
      JSON.stringify(actual.tokens.toTokens()) === JSON.stringify(expected.tokens.toTokens()),
      'Catch-up tokens differ from a fresh full tokenization',
    )
  } finally {
    fresh.dispose()
    analysis.dispose()
  }
  await owner.awaitIdleFence()
}

async function dispose() {
  if (!active) return
  released = [new WeakRef(active.session), new WeakRef(active.buffer.getSnapshot())]
  active.session.dispose()
  active.analysis.dispose()
  await active.owner.dispose()
  active.stopObservation()
  active = null
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = null
}

const bridge = {
  async open(size: number, instrumented: boolean) {
    active = await setup(size, instrumented)
    return active.open
  },
  run,
  dispose,
  retained: () => released.filter((reference) => reference.deref()).length,
}

declare global {
  var __copies: typeof bridge
  interface Performance {
    readonly memory: { readonly usedJSHeapSize: number }
  }
}
globalThis.__copies = bridge
