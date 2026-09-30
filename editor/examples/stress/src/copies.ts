import {
  applyBatchToPieceTable,
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
  type DocumentSessionChange,
  type PieceTableSnapshot,
} from '@singapore-editor/core/document'
import { createShikiWorkerOwner } from '@singapore-editor/core/shiki'
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

function change(
  snapshot: PieceTableSnapshot,
  edits: DocumentSessionChange['edits'],
): DocumentSessionChange {
  return {
    kind: 'edit',
    edits,
    transaction: null,
    snapshot,
    textSnapshot: createDocumentTextSnapshot(snapshot),
    selections: { selections: [], normalized: true },
    timings: [],
    canUndo: true,
    canRedo: false,
    isDirty: true,
    logicalRevisionCount: 1,
    logicalRevisionScope: null,
  }
}

async function setup(size: number, instrumented: boolean) {
  // A trivial real grammar isolates document transport from regex grammar cost.
  const language = { name: 'copy-proof', scopeName: 'source.copy-proof', patterns: [] }
  const theme = {
    name: 'copy-proof',
    settings: [{ settings: { foreground: '#ffffff', background: '#000000' } }],
  }
  const registrations = {
    languageRegistrations: [language],
    themeRegistration: theme,
    themeRegistrations: [theme],
  }
  const owner = createShikiWorkerOwner()
  const request = owner.request.bind(owner)
  owner.request = (payload) => {
    heapAtRequest = Math.max(heapAtRequest, performance.memory.usedJSHeapSize)
    if ('text' in payload) wireUnits += payload.text?.length ?? 0
    if ('edits' in payload)
      wireUnits += payload.edits?.reduce((sum, edit) => sum + edit.text.length, 0) ?? 0
    return request(payload)
  }
  let snapshot = createPieceTableSnapshot(
    `${'x'.repeat(4095)}\n`.repeat(Math.ceil(size / 4096)).slice(0, size),
  )
  for (let index = 1; index <= 32; index++) {
    const offset = Math.floor((size * index) / 33)
    snapshot = applyBatchToPieceTable(snapshot, [{ from: offset, to: offset + 1, text: 'y' }])
  }
  const session = owner.createSession({
    documentId: 'copy-proof',
    languageId: 'copy-proof',
    lang: 'copy-proof',
    theme: theme.name,
    snapshot,
    textSnapshot: createDocumentTextSnapshot(snapshot),
    registrations,
  })
  check(session, 'Shiki session was not created')
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = instrumented ? diagnostic : null
  const open = await measure('open', () => session.refresh(createDocumentTextSnapshot(snapshot)))
  return { owner, session, snapshot, open, registrations }
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
  const { session } = active
  const samples: Sample[] = []
  for (let index = 0; index < repetitions; index++) {
    const before = active.snapshot
    const first = { from: before.length - 9, to: before.length - 9, text: 'a' }
    const intermediate = applyBatchToPieceTable(before, [first])
    const last = { from: intermediate.length - 8, to: intermediate.length - 8, text: 'b' }
    const next = applyBatchToPieceTable(intermediate, [last])
    samples.push(await measure('skipped-edit', () => session.applyChange(change(next, [last]))))
    samples.push(await measure('undo-branch', () => session.applyChange(change(before, []))))
    const normal = applyBatchToPieceTable(before, [first])
    samples.push(await measure('incremental', () => session.applyChange(change(normal, [first]))))
    active.snapshot = normal
  }
  await verifyTokens()
  return samples
}

async function verifyTokens() {
  check(active, 'No active session')
  const { snapshot, registrations, owner, session } = active
  const source = createDocumentTextSnapshot(snapshot)
  const fresh = owner.createSession({
    documentId: 'reference',
    languageId: 'copy-proof',
    lang: 'copy-proof',
    theme: 'copy-proof',
    snapshot,
    textSnapshot: source,
    registrations,
  })
  check(fresh, 'Reference session was not created')
  const expected = await fresh.refresh(source)
  const actual = await session.refresh(createDocumentTextSnapshot(snapshot))
  check(
    JSON.stringify(actual.tokens.toTokens()) === JSON.stringify(expected.tokens.toTokens()),
    'Catch-up tokens differ from a fresh full tokenization',
  )
  fresh.dispose()
  await owner.awaitIdleFence()
}

async function dispose() {
  if (!active) return
  released = [new WeakRef(active.session), new WeakRef(active.snapshot)]
  active.session.dispose()
  await active.owner.dispose()
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
