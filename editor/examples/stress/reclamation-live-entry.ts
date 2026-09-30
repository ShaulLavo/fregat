import type { TextMeasurements } from '../../packages/editor/dist/textMeasurements.js'
import { Editor } from '@singapore-editor/core/editor'
import {
  acquireDocumentMutationLease,
  releaseDocumentMutationLease,
  rotateDocumentSyncSegment,
  createEditorTextBuffer,
  createEditorBufferSession,
  readPieceTableTextRange,
  type DocumentTextSnapshot,
} from '@singapore-editor/core/document'
import { measureTextSnapshotRange } from '../../packages/editor/dist/documentTextSnapshot.js'
import { fail } from './errors.ts'
import { TextPage } from '../../packages/textbuffer/dist/textPages.js'
import { TextStorageMaintenance } from '../../packages/editor/dist/textStorageMaintenance.js'
import { bufferTextPages, bufferStoreExtent } from '../../packages/textbuffer/dist/buffers.js'
import '@singapore-editor/core/style.css'

const workload = new URLSearchParams(location.search).get('workload') ?? 'aligned'
const ORIGINAL_UNITS = 4 * 1024 * 1024

function payloadText() {
  return Array.from(
    { length: ORIGINAL_UNITS / 64 },
    (_, index) =>
      index.toString().padStart(8, '0') + ' original retained paragraph '.padEnd(56, 'x'),
  ).join('')
}

function initialText() {
  if (workload !== 'original') return 'prefix suffix'
  return 'prefix ' + payloadText() + 'suffix'
}

const buffer = createEditorTextBuffer(initialText())
const session = createEditorBufferSession(buffer)
const editors = [0, 1].map((index) => {
  const host = document.createElement('div')
  host.id = `editor-${index}`
  host.style.cssText = 'width:700px;height:160px'
  document.body.append(host)
  const editor = new Editor(host)
  editor.attachSession(createEditorBufferSession(buffer), { documentId: 'reclamation.txt' })
  return editor
})
let pinnedSnapshot: ReturnType<typeof buffer.getSnapshot> | null = null
let pinnedMeasurements: TextMeasurements | null = null
let maintainedSnapshot: ReturnType<typeof buffer.getSnapshot> | null = null
let maintainedWrapper: DocumentTextSnapshot | null = null
let inputSamples: number[] = []
let probeActive = false
let probeLength = 0
let churnSentinel: WeakRef<{ label: string }> | null = null

window.addEventListener(
  'keydown',
  (event) => {
    if (!probeActive || !event.isTrusted || event.key.length !== 1) return
    const start = performance.now()
    requestAnimationFrame(() =>
      requestAnimationFrame(() => inputSamples.push(performance.now() - start)),
    )
  },
  true,
)

function keptUnits(kind: string, cycle: number) {
  if (kind === 'survivors') return 64
  if (kind === 'mixed' && cycle % 4 === 0) return 1024
  return 0
}

function churnInsertions(cycles: number, kind: string) {
  let deletedUnits = 0
  for (let cycle = 0; cycle < cycles; cycle++) {
    const size = kind === 'aligned' ? 16384 : 1024
    const text = cycle.toString().padStart(8, '0') + 'x'.repeat(size - 8)
    const kept = keptUnits(kind, cycle)
    session.applyEdits([{ from: 7, to: 7, text }])
    if (kept === text.length) continue
    session.applyEdits([{ from: 7 + kept, to: 7 + text.length, text: '' }])
    deletedUnits += text.length - kept
  }
  session.applyEdits([{ from: 7, to: 7, text: '!' }])
  return deletedUnits
}

function churnParagraphs(cycles: number) {
  let length = 0
  let deletedUnits = 0
  for (let cycle = 0; cycle < cycles; cycle++) {
    const text = cycle.toString().padStart(8, '0') + 'p'.repeat(1016)
    session.applyEdits([{ from: 7, to: 7 + length, text }])
    deletedUnits += length
    length = text.length
  }
  return deletedUnits
}

function releaseSyncPayload() {
  const acquired = acquireDocumentMutationLease(
    buffer,
    buffer.getRevision(),
    buffer.getSnapshot(),
    'heap-fixture',
  )
  if (acquired.status !== 'acquired') return acquired.status
  const rotated = rotateDocumentSyncSegment(buffer, buffer.getDocumentSyncPoint(), acquired.lease)
  releaseDocumentMutationLease(buffer, acquired.lease)
  return rotated.status
}

function state() {
  return {
    revision: buffer.getRevision(),
    dirty: buffer.isDirty(),
    text: buffer.materializeFullText(),
    retainedCodeUnits: bufferStoreExtent(buffer.getSnapshot().buffers)?.retainedCodeUnits ?? 0,
  }
}

const reclamationLive = {
  buffer,
  editors,
  churn(cycles: number, kind: string) {
    churnSentinel = new WeakRef({ label: 'reclamation churn task sentinel' })
    const started = performance.now()
    const deletedUnits =
      kind === 'paragraph' ? churnParagraphs(cycles) : churnInsertions(cycles, kind)
    const result = {
      churnMs: performance.now() - started,
      deletedUnits,
      ...state(),
      registryEntriesAtChurnEnd: registryPages().length,
    }
    maintenance().suspend()
    return result
  },
  suspendMaintenance() {
    maintenance().suspend()
    return buffer.getStorageMaintenanceStats().completed
  },
  resumeMaintenance() {
    maintenance().resume()
  },
  heapCalibration(inspectWeakTargets = false): {
    registryEntries: number
    maintenanceCompleted: number
    sentinelAlive?: boolean
    sentinelCreated?: boolean
    livePages?: number
    logicalUnits?: number
    backingUnits?: number
  } {
    const entries = registryPages()
    const result = {
      registryEntries: entries.length,
      maintenanceCompleted: buffer.getStorageMaintenanceStats().completed,
    }
    if (!inspectWeakTargets) return result
    let livePages = 0
    let logicalUnits = 0
    let backingUnits = 0
    for (const entry of entries) {
      const page = entry.deref()
      if (!page) continue
      livePages++
      logicalUnits += page.length
      backingUnits += page.storageLength
    }
    return {
      ...result,
      sentinelCreated: churnSentinel !== null,
      sentinelAlive: churnSentinel?.deref() !== undefined,
      livePages,
      logicalUnits,
      backingUnits,
    }
  },
  deleteOriginal() {
    pinnedSnapshot = buffer.getSnapshot()
    pinnedMeasurements = measureTextSnapshotRange(buffer.getTextSnapshot(), 0, 128)
    pinnedMeasurements.columnAt(128, 4, 'utf16')
    const length = pinnedSnapshot.length
    session.applyEdits([{ from: 7, to: length - 6, text: '' }])
    return { originalUnits: length, deletedUnits: length - 13, ...state() }
  },
  pasteTail() {
    const text = payloadText() + 'tail'.repeat(16)
    session.applyEdits([{ from: 7, to: 7, text }])
    pinnedSnapshot = buffer.getSnapshot()
    pinnedMeasurements = measureTextSnapshotRange(buffer.getTextSnapshot(), 0, 128)
    pinnedMeasurements.columnAt(128, 4, 'utf16')
    session.applyEdits([{ from: 7, to: 7 + text.length - 64, text: '' }])
    // Reset the sync reader without appending to (and potentially flattening) the borrowed tail.
    const syncReset = releaseSyncPayload()
    buffer.clearHistory()
    buffer.markClean()
    return { pastedUnits: text.length, deletedUnits: text.length - 64, syncReset, ...state() }
  },
  inspectPins() {
    if (!pinnedSnapshot || !pinnedMeasurements) fail('Missing retained pin fixture')
    return {
      oldPrefix: readPieceTableTextRange(pinnedSnapshot, 0, 15),
      oldSuffix: readPieceTableTextRange(
        pinnedSnapshot,
        pinnedSnapshot.length - 6,
        pinnedSnapshot.length,
      ),
      measuredColumn: pinnedMeasurements.columnAt(128, 4, 'utf16'),
      originalUnits: pinnedSnapshot.length,
    }
  },
  releaseSessionOwners() {
    buffer.clearHistory()
    buffer.markClean()
    return this.capture()
  },
  releaseSnapshot() {
    pinnedSnapshot = null
  },
  releaseMeasurements() {
    if (!pinnedMeasurements) fail('Missing retained measurement fixture')
    const column = pinnedMeasurements.columnAt(128, 4, 'utf16')
    pinnedMeasurements = null
    return column
  },
  capture() {
    maintainedSnapshot = buffer.getSnapshot()
    maintainedWrapper = buffer.getTextSnapshot()
    return state()
  },
  maintained() {
    return {
      ...state(),
      snapshotIdentity: maintainedSnapshot === buffer.getSnapshot(),
      wrapperIdentity: maintainedWrapper === buffer.getTextSnapshot(),
      stats: buffer.getStorageMaintenanceStats(),
      texts: editors.map((editor) => editor.materializeFullText()),
    }
  },
  undoRedo() {
    const texts = []
    while (buffer.canUndo()) {
      texts.push(buffer.materializeFullText())
      buffer.undo()
    }
    const count = texts.length
    while (buffer.canRedo()) {
      buffer.redo()
      if (buffer.materializeFullText() !== texts.pop()) return { valid: false, count }
    }
    return { valid: texts.length === 0, count }
  },
  prepareInput() {
    editors[0].setSelection(0, 0)
    editors[0].focus()
  },
  beginInputProbe() {
    this.prepareInput()
    inputSamples = []
    probeLength = buffer.getSnapshot().length
    probeActive = true
  },
  endInputProbe() {
    probeActive = false
    const added = buffer.getSnapshot().length - probeLength
    session.applyEdits([{ from: 0, to: added, text: '' }])
    return inputSamples
  },
  dispose() {
    for (const editor of editors) editor.dispose()
  },
}

function maintenance(): TextStorageMaintenance {
  const value: unknown = Reflect.get(buffer, 'storageMaintenance')
  if (!(value instanceof TextStorageMaintenance)) fail('Missing storage maintenance fixture')
  return value
}

function registryPages(): WeakRef<TextPage>[] {
  const entries: unknown = Reflect.get(bufferTextPages(buffer.getSnapshot().buffers), 'entries')
  if (!(entries instanceof Set)) fail('Missing borrowed page registry')
  const pages: WeakRef<TextPage>[] = []
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('page' in entry) ||
      !(entry.page instanceof WeakRef)
    )
      fail('Invalid borrowed page registry')
    const page: unknown = entry.page.deref()
    if (page !== undefined && !(page instanceof TextPage)) fail('Invalid borrowed page')
    pages.push(entry.page)
  }
  return pages
}

declare global {
  interface Window {
    reclamationLive: typeof reclamationLive
  }
}
window.reclamationLive = reclamationLive
