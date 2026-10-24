import {
  createPieceTableSnapshot,
  createPieceTableWalker,
  deleteFromPieceTable,
  diffPieceTableSnapshots,
  insertIntoPieceTable,
  materializePieceTableFullText,
  type PieceTableSnapshot,
  pieceTableSnapshotsHaveSameText,
  readPieceTableTextRange,
  streamPieceTableTextChunks,
} from '@singapore-editor/textbuffer'

type Sample = {
  label: string
  iterations: number
  walkerMs: number
  baselineMs: number
  baselineLabel: string
}

const EDIT_COUNT = 2_000
const ITERATIONS = 50
const WARMUP_ITERATIONS = 10
const SEEK_COUNT = 5_000
const SEEK_READ_LENGTH = 64

const formatMs = (value: number): string => `${value.toFixed(4)}ms`

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const buildFragmentedSnapshot = (): { snapshot: PieceTableSnapshot; text: string } => {
  const random = createRandom(42)
  let snapshot = createPieceTableSnapshot('seed text for the walker benchmark\n'.repeat(200))

  for (let index = 0; index < EDIT_COUNT; index++) {
    const length = snapshot.length
    if (length > 0 && random() < 0.4) {
      const start = Math.floor(random() * length)
      const deleteLength = 1 + Math.floor(random() * Math.min(64, length - start))
      snapshot = deleteFromPieceTable(snapshot, start, deleteLength)
    } else {
      const offset = Math.floor(random() * (length + 1))
      const insertLength = 1 + Math.floor(random() * 80)
      snapshot = insertIntoPieceTable(snapshot, offset, 'y'.repeat(insertLength))
    }
  }

  return { snapshot, text: materializePieceTableFullText(snapshot) }
}

const measure = (run: () => void): number => {
  for (let index = 0; index < WARMUP_ITERATIONS; index++) run()
  const start = performance.now()
  for (let index = 0; index < ITERATIONS; index++) run()
  return (performance.now() - start) / ITERATIONS
}

const sumCharCodes = (text: string): number => {
  let sum = 0
  for (let index = 0; index < text.length; index++) sum += text.charCodeAt(index)
  return sum
}

const measureSequentialWalk = (
  snapshot: PieceTableSnapshot,
  text: string,
): { sample: Sample; twoCallMs: number } => {
  const expected = sumCharCodes(text)

  const walkerMs = measure(() => {
    const walker = createPieceTableWalker(snapshot)
    let sum = 0
    for (let code = walker.next(); code !== -1; code = walker.next()) sum += code
    if (sum !== expected) throw new Error('walker sequential sum mismatch')
  })

  const twoCallMs = measure(() => {
    const walker = createPieceTableWalker(snapshot)
    let sum = 0
    while (!walker.exhausted()) sum += walker.next()
    if (sum !== expected) throw new Error('walker exhausted-loop sum mismatch')
  })

  const baselineMs = measure(() => {
    const sum = sumCharCodes(materializePieceTableFullText(snapshot))
    if (sum !== expected) throw new Error('materialize sequential sum mismatch')
  })

  return {
    sample: {
      label: 'sequential full-document walk (sentinel next() loop)',
      iterations: ITERATIONS,
      walkerMs,
      baselineMs,
      baselineLabel: 'materialize + charCodeAt loop',
    },
    twoCallMs,
  }
}

const measureChunkWalk = (snapshot: PieceTableSnapshot, text: string): Sample => {
  const expected = text.length

  const walkerMs = measure(() => {
    const walker = createPieceTableWalker(snapshot)
    let total = 0
    for (;;) {
      const chunk = walker.chunk()
      if (!chunk) break
      total += chunk.text.length
      if (!walker.nextChunk()) break
    }
    if (total !== expected) throw new Error('walker chunk length mismatch')
  })

  const baselineMs = measure(() => {
    let total = 0
    streamPieceTableTextChunks(snapshot, (chunkText) => {
      total += chunkText.length
    })
    if (total !== expected) throw new Error('stream chunk length mismatch')
  })

  return {
    label: 'chunk-wise full-document walk',
    iterations: ITERATIONS,
    walkerMs,
    baselineMs,
    baselineLabel: 'streamPieceTableTextChunks',
  }
}

const measureSeekHeavy = (snapshot: PieceTableSnapshot, text: string): Sample => {
  const random = createRandom(7)
  const offsets: number[] = []
  for (let index = 0; index < SEEK_COUNT; index++) {
    offsets.push(Math.floor(random() * Math.max(1, text.length - SEEK_READ_LENGTH)))
  }

  let expected = 0
  for (const offset of offsets) {
    expected += sumCharCodes(text.slice(offset, offset + SEEK_READ_LENGTH))
  }

  const walkerMs = measure(() => {
    const walker = createPieceTableWalker(snapshot)
    let sum = 0
    for (const offset of offsets) {
      walker.seek(offset)
      for (let index = 0; index < SEEK_READ_LENGTH; index++) sum += walker.next()
    }
    if (sum !== expected) throw new Error('walker seek-read sum mismatch')
  })

  const baselineMs = measure(() => {
    let sum = 0
    for (const offset of offsets) {
      sum += sumCharCodes(readPieceTableTextRange(snapshot, offset, offset + SEEK_READ_LENGTH))
    }
    if (sum !== expected) throw new Error('range-read sum mismatch')
  })

  return {
    label: `${SEEK_COUNT} random seeks + ${SEEK_READ_LENGTH}-char reads`,
    iterations: ITERATIONS,
    walkerMs,
    baselineMs,
    baselineLabel: 'readPieceTableTextRange',
  }
}

const measureEqualityAndDiff = (snapshot: PieceTableSnapshot, text: string): void => {
  // Equal text built through a divergent history: piece layouts differ.
  const convergent = insertIntoPieceTable(
    deleteFromPieceTable(snapshot, 100, 50),
    100,
    text.slice(100, 150),
  )
  const editOffset = Math.floor(text.length / 2)
  const edited = insertIntoPieceTable(snapshot, editOffset, 'EDIT')

  const equalityMs = measure(() => {
    if (!pieceTableSnapshotsHaveSameText(snapshot, convergent)) {
      throw new Error('expected convergent snapshots to compare equal')
    }
    if (pieceTableSnapshotsHaveSameText(snapshot, edited)) {
      throw new Error('expected edited snapshot to compare unequal')
    }
  })

  const diffMs = measure(() => {
    const edit = diffPieceTableSnapshots(snapshot, edited)
    if (!edit || edit.from !== editOffset || edit.text !== 'EDIT') {
      throw new Error('unexpected diff result for the small edit')
    }
    if (diffPieceTableSnapshots(snapshot, convergent) !== null) {
      throw new Error('expected null diff for equal text')
    }
  })

  console.log('equality (equal + unequal pair):', formatMs(equalityMs))
  console.log('diff (small edit in large doc + equal pair):', formatMs(diffMs))
}

const printSample = (sample: Sample): void => {
  console.log(`walker benchmark: ${sample.label}`)
  console.log(`  walker: ${formatMs(sample.walkerMs)}`)
  console.log(`  ${sample.baselineLabel}: ${formatMs(sample.baselineMs)}`)
}

const { snapshot, text } = buildFragmentedSnapshot()
console.log(
  `document: ${text.length} chars, ${snapshot.pieceCount} pieces after ${EDIT_COUNT} edits`,
)
const sequential = measureSequentialWalk(snapshot, text)
printSample(sequential.sample)
console.log(`  exhausted()+next() loop: ${formatMs(sequential.twoCallMs)}`)
printSample(measureChunkWalk(snapshot, text))
printSample(measureSeekHeavy(snapshot, text))
measureEqualityAndDiff(snapshot, text)
