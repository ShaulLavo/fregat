import { performance } from 'node:perf_hooks'

import {
  anchorAfter,
  createPieceTableSnapshot,
  debugPieceTable,
  deleteFromPieceTable,
  insertIntoPieceTable,
  type PieceTableSnapshot,
  type RealAnchor,
  resolveAnchor,
} from '@singapore-editor/textbuffer'
import {
  buildReverseIndex,
  reverseIndexEntries,
} from '@singapore-editor/textbuffer/internal/reverseIndex'

type MemorySample = {
  heapUsedMb: number
  heapTotalMb: number
  rssMb: number
}

type PieceCounts = {
  visible: number
  invisible: number
}

type Sample = {
  lines: number
  pieces: number
  visiblePieces: number
  invisiblePieces: number
  reverseIndexNodes: number
  rebuiltReverseIndexNodes: number
  anchors: number
  textLength: number
  buildMs: number
  reverseIndexRebuildMs: number
  invisibleValidationMs: number
  averageInsertionMs: number
  averageAnchorCreateMs: number
  averageResolveMs: number
  averageDeleteRetypeMs: number
  memoryStart: MemorySample
  memoryAfterBuild: MemorySample
  memoryAfterAnchors: MemorySample
  memoryAfterInvisibleValidation: MemorySample
  memoryAfterForcedGc: MemorySample
  forcedGcAvailable: boolean
}

const LINE_COUNTS = [10_000, 50_000, 100_000] as const
const ANCHOR_STRIDE = 1_000
const DELETE_RETYPE_EDITS = 1_000

const formatMs = (value: number): string => `${value.toFixed(4)}ms`

const toMb = (bytes: number): number => bytes / 1024 / 1024

const readMemory = (): MemorySample => {
  const usage = process.memoryUsage()
  return {
    heapUsedMb: toMb(usage.heapUsed),
    heapTotalMb: toMb(usage.heapTotal),
    rssMb: toMb(usage.rss),
  }
}

const forceGc = (): boolean => {
  if (typeof Bun !== 'undefined' && typeof Bun.gc === 'function') {
    Bun.gc(true)
    return true
  }

  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
    return true
  }

  return false
}

const formatMemory = (memory: MemorySample): string =>
  `heap ${memory.heapUsedMb.toFixed(2)} / ${memory.heapTotalMb.toFixed(2)} MiB, rss ${memory.rssMb.toFixed(2)} MiB`

const countPieces = (snapshot: PieceTableSnapshot): PieceCounts => {
  const counts: PieceCounts = { visible: 0, invisible: 0 }

  for (const piece of debugPieceTable(snapshot)) {
    if (piece.visible) {
      counts.visible++
      continue
    }

    counts.invisible++
  }

  return counts
}

const buildSnapshot = (lineCount: number) => {
  let snapshot = createPieceTableSnapshot('')
  const start = performance.now()

  for (let line = 0; line < lineCount; line++) {
    snapshot = insertIntoPieceTable(snapshot, snapshot.length, `line-${line}\n`)
  }

  return {
    snapshot,
    buildMs: performance.now() - start,
  }
}

const createAnchors = (snapshot: PieceTableSnapshot): RealAnchor[] => {
  const anchors: RealAnchor[] = []

  for (let offset = 0; offset <= snapshot.length; offset += ANCHOR_STRIDE) {
    anchors.push(anchorAfter(snapshot, offset))
  }

  return anchors
}

const rebuildReverseIndex = (snapshot: PieceTableSnapshot) => {
  const start = performance.now()
  const root = buildReverseIndex(snapshot.root)

  return {
    reverseIndexRebuildMs: performance.now() - start,
    rebuiltReverseIndexNodes: reverseIndexEntries(root).length,
  }
}

const deleteRetypeOffset = (snapshot: PieceTableSnapshot, editIndex: number): number => {
  const span = Math.max(1, snapshot.length - 1)
  return Math.floor(((editIndex + 1) * span) / (DELETE_RETYPE_EDITS + 1))
}

const validateInvisiblePieces = (snapshot: PieceTableSnapshot) => {
  let next = snapshot
  const start = performance.now()

  for (let edit = 0; edit < DELETE_RETYPE_EDITS && next.length > 0; edit++) {
    const offset = deleteRetypeOffset(next, edit)
    next = deleteFromPieceTable(next, offset, 1)
    next = insertIntoPieceTable(next, offset, 'x')
  }

  const duration = performance.now() - start

  return {
    snapshot: next,
    invisibleValidationMs: duration,
    averageDeleteRetypeMs: duration / DELETE_RETYPE_EDITS,
  }
}

const measureResolves = (snapshot: PieceTableSnapshot, anchors: readonly RealAnchor[]): number => {
  const start = performance.now()

  for (const anchor of anchors) resolveAnchor(snapshot, anchor)

  return performance.now() - start
}

const measure = (lineCount: number): Sample => {
  const forcedGcAvailable = forceGc()
  const memoryStart = readMemory()
  const { snapshot, buildMs } = buildSnapshot(lineCount)

  forceGc()
  const memoryAfterBuild = readMemory()
  const index = rebuildReverseIndex(snapshot)
  forceGc()

  const anchorStart = performance.now()
  const anchors = createAnchors(snapshot)
  const anchorCreateMs = performance.now() - anchorStart
  const resolveMs = measureResolves(snapshot, anchors)
  const memoryAfterAnchors = readMemory()

  const invisibleValidation = validateInvisiblePieces(snapshot)
  const memoryAfterInvisibleValidation = readMemory()
  forceGc()
  const memoryAfterForcedGc = readMemory()
  const counts = countPieces(invisibleValidation.snapshot)

  return {
    lines: lineCount,
    pieces: invisibleValidation.snapshot.pieceCount,
    visiblePieces: counts.visible,
    invisiblePieces: counts.invisible,
    reverseIndexNodes: reverseIndexEntries(invisibleValidation.snapshot.reverseIndex).length,
    rebuiltReverseIndexNodes: index.rebuiltReverseIndexNodes,
    anchors: anchors.length,
    textLength: invisibleValidation.snapshot.length,
    buildMs,
    reverseIndexRebuildMs: index.reverseIndexRebuildMs,
    invisibleValidationMs: invisibleValidation.invisibleValidationMs,
    averageInsertionMs: buildMs / lineCount,
    averageAnchorCreateMs: anchorCreateMs / anchors.length,
    averageResolveMs: resolveMs / anchors.length,
    averageDeleteRetypeMs: invisibleValidation.averageDeleteRetypeMs,
    memoryStart,
    memoryAfterBuild,
    memoryAfterAnchors,
    memoryAfterInvisibleValidation,
    memoryAfterForcedGc,
    forcedGcAvailable,
  }
}

const printSample = (sample: Sample): void => {
  console.log(`anchor benchmark: ${sample.lines.toLocaleString()} lines`)
  console.log(
    `pieces: ${sample.pieces} (${sample.visiblePieces} visible, ${sample.invisiblePieces} invisible)`,
  )
  console.log(`reverse index nodes: ${sample.reverseIndexNodes}`)
  console.log(`rebuilt reverse index nodes: ${sample.rebuiltReverseIndexNodes}`)
  console.log(`anchors: ${sample.anchors}`)
  console.log(`text length: ${sample.textLength}`)
  console.log(`snapshot build with incremental index: ${formatMs(sample.buildMs)}`)
  console.log(`reverse index rebuild: ${formatMs(sample.reverseIndexRebuildMs)}`)
  console.log(`delete/retype invisible-piece validation: ${formatMs(sample.invisibleValidationMs)}`)
  console.log(`average insertion with index: ${formatMs(sample.averageInsertionMs)}`)
  console.log(`average anchor create: ${formatMs(sample.averageAnchorCreateMs)}`)
  console.log(`average indexed resolve: ${formatMs(sample.averageResolveMs)}`)
  console.log(`average delete/retype edit: ${formatMs(sample.averageDeleteRetypeMs)}`)
  console.log(`forced GC available: ${sample.forcedGcAvailable ? 'yes' : 'no'}`)
  console.log(`memory start: ${formatMemory(sample.memoryStart)}`)
  console.log(`memory after build + GC: ${formatMemory(sample.memoryAfterBuild)}`)
  console.log(`memory after anchors/resolves: ${formatMemory(sample.memoryAfterAnchors)}`)
  console.log(
    `memory after invisible validation: ${formatMemory(sample.memoryAfterInvisibleValidation)}`,
  )
  console.log(`memory after forced GC: ${formatMemory(sample.memoryAfterForcedGc)}`)
}

for (const lineCount of LINE_COUNTS) {
  printSample(measure(lineCount))
}
