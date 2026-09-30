import { describe, expect, test, vi } from 'vitest'
import {
  anchorAfter,
  anchorBefore,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  diffPieceTableSnapshots,
  insertIntoPieceTable,
  materializePieceTableFullText,
  offsetToPoint,
  pieceTableSnapshotsHaveSameText,
  readPieceTableLine,
  resolveAnchor,
  resolveAnchorLinear,
} from './index'
import {
  BUFFER_CHUNK_SIZE,
  appendChunksToBuffers,
  createInitialBuffers,
  reclaimBufferGroup,
  bufferStorageIdentity,
  chunkOfBuffer,
  getBufferText,
} from './buffers'
import { validatePieceTreeInvariants } from './inspection'
import { reclaimPieceTableText, reclaimSnapshotStorage } from './reclamation'
import { flattenPieces } from './tree'
import type { PieceTableSnapshot } from './pieceTableTypes'
import type { CreatePieceTableSnapshotOptions } from './snapshot'

const payload = 'x\n'.repeat(BUFFER_CHUNK_SIZE / 2)

function retiredFixture(options: CreatePieceTableSnapshotOptions = {}) {
  const original = createPieceTableSnapshot('prefix suffix', options)
  const inserted = insertIntoPieceTable(original, 7, payload)
  const left = anchorBefore(inserted, 8)
  const right = anchorAfter(inserted, 8)
  const deleted = deleteFromPieceTable(inserted, 7, payload.length)
  const current = insertIntoPieceTable(deleted, 7, 'NEW')
  return { original, inserted, current, left, right }
}

function expectValid(snapshot: PieceTableSnapshot) {
  expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])
}

describe('reclaiming closed chunks without removing position records', () => {
  test('preserves retained text, both deleted biases and every tree/index identity', () => {
    const { inserted, current, left, right } = retiredFixture()
    const compact = reclaimPieceTableText(current)
    expect(compact).not.toBe(current)
    expect(compact.root).toBe(current.root)
    expect(compact.reverseIndex).toBe(current.reverseIndex)
    expect(compact.buffers.identity).toBe(current.buffers.identity)
    expect(compact.buffers.nextBufferSequence).toBe(current.buffers.nextBufferSequence)
    expect(materializePieceTableFullText(compact)).toBe('prefix NEWsuffix')
    expect(materializePieceTableFullText(inserted)).toBe('prefix ' + payload + 'suffix')
    expect(resolveAnchor(compact, left)).toEqual({ offset: 7, liveness: 'deleted' })
    expect(resolveAnchor(compact, right)).toEqual({ offset: 10, liveness: 'deleted' })
    expect(resolveAnchorLinear(compact, right)).toEqual(resolveAnchor(compact, right))
    expect(diffPieceTableSnapshots(current, compact)).toBeNull()
    expect(pieceTableSnapshotsHaveSameText(current, compact)).toBe(true)
    expectValid(compact)
    expectValid(inserted)
  })

  test('drops both the payload and its scanned line index from the fork only', () => {
    const { inserted, current, left } = retiredFixture()
    expect(readPieceTableLine(inserted, 100)).toBe('x')
    const chunk = chunkOfBuffer(current.buffers, left.buffer)
    expect(current.buffers.lineIndexes.has(chunk)).toBe(true)
    const compact = reclaimPieceTableText(current)
    expect(compact.buffers.chunks.get(left.buffer)).toBeUndefined()
    expect(compact.buffers.lineIndexes.has(chunk)).toBe(false)
    expect(getBufferText(inserted.buffers, left.buffer)).toBe(payload)
    expect(current.buffers.lineIndexes.has(chunk)).toBe(true)
    expectValid(compact)
  })

  test('releases deleted portions of a partly live closed chunk', () => {
    const initial = createPieceTableSnapshot('ab')
    const inserted = insertIntoPieceTable(initial, 1, payload)
    const partial = deleteFromPieceTable(inserted, 1, payload.length - 1)
    const current = insertIntoPieceTable(partial, 0, '!')
    const compact = reclaimPieceTableText(current)
    expect(compact).not.toBe(current)
    expect(readPieceTableLine(compact, 0)).toBe('!a')
    expectValid(current)
  })

  test('reclaims once, keeps original text and tail, and supports further forks and appends', () => {
    const { current, left, right } = retiredFixture()
    const compact = reclaimPieceTableText(current)
    expect(reclaimPieceTableText(compact)).toBe(compact)
    const next = insertIntoPieceTable(compact, 7, '😀\n')
    const sibling = insertIntoPieceTable(compact, 7, 'different\n')
    expect(materializePieceTableFullText(next)).toBe('prefix 😀\nNEWsuffix')
    expect(materializePieceTableFullText(sibling)).toBe('prefix different\nNEWsuffix')
    expect(resolveAnchor(next, left).offset).toBe(7)
    expect(resolveAnchor(next, right).offset).toBe(13)
    expect(offsetToPoint(next, 10)).toEqual({ row: 1, column: 0 })
    expectValid(next)
    expectValid(sibling)
    expectValid(compact)
  })

  test('does not confuse equal buffer ids on different history branches', () => {
    const initial = createPieceTableSnapshot('base')
    const a = insertIntoPieceTable(initial, 0, payload)
    const b = insertIntoPieceTable(initial, 0, 'y'.repeat(payload.length))
    const aDeleted = deleteFromPieceTable(a, 0, payload.length)
    const aCurrent = insertIntoPieceTable(aDeleted, 0, '!')
    const bCurrent = insertIntoPieceTable(b, 0, '?')
    const aCompact = reclaimPieceTableText(aCurrent)
    expect(reclaimPieceTableText(bCurrent)).toBe(bCurrent)
    expect(materializePieceTableFullText(b)).toBe('y'.repeat(payload.length) + 'base')
    expect(materializePieceTableFullText(aCompact)).toBe('!base')
    expectValid(aCompact)
    expectValid(bCurrent)
  })

  test('retains transient roots before sharing them with the reclaimed fork', () => {
    const { current } = retiredFixture({ transient: true })
    const compact = reclaimPieceTableText(current)
    const edited = deleteFromPieceTable(compact, 0, 3)
    expect(materializePieceTableFullText(current)).toBe('prefix NEWsuffix')
    expect(materializePieceTableFullText(compact)).toBe('prefix NEWsuffix')
    expect(materializePieceTableFullText(edited)).toBe('fix NEWsuffix')
    expectValid(edited)
  })

  test('publishes shared history storage while an external old reader keeps its own log', () => {
    const { inserted, current } = retiredFixture()
    const next = insertIntoPieceTable(current, 0, '!')
    const oldLog = bufferStorageIdentity(inserted.buffers)
    const currentRoot = current.root
    const job = reclaimSnapshotStorage([current, next, current])
    let step = job.next()
    while (!step.done) step = job.next()
    expect(step.value).toMatchObject({ chunks: 1, codeUnits: payload.length, snapshots: 2 })
    expect(current.root).toBe(currentRoot)
    expect(bufferStorageIdentity(current.buffers)).toBe(bufferStorageIdentity(next.buffers))
    expect(bufferStorageIdentity(current.buffers)).not.toBe(oldLog)
    expect(bufferStorageIdentity(inserted.buffers)).toBe(oldLog)
    expect(materializePieceTableFullText(inserted)).toBe('prefix ' + payload + 'suffix')
    expect(materializePieceTableFullText(next)).toBe('!prefix NEWsuffix')
    expectValid(current)
    expectValid(next)
  })

  test('groups by append log rather than equal buffer ids across branches', () => {
    const { original, current } = retiredFixture()
    const sibling = insertIntoPieceTable(original, 0, 'y'.repeat(payload.length))
    const siblingNext = insertIntoPieceTable(sibling, 0, '?')
    const job = reclaimSnapshotStorage([current, sibling, siblingNext])
    while (!job.next().done) {
      /* Run all collector slices. */
    }
    expect(materializePieceTableFullText(current)).toBe('prefix NEWsuffix')
    expect(materializePieceTableFullText(siblingNext)).toBe(
      '?' + 'y'.repeat(payload.length) + 'prefix suffix',
    )
    expectValid(current)
    expectValid(siblingNext)
  })

  test('cancellation cannot split a prepared history group across storage logs', () => {
    let { current } = retiredFixture()
    const snapshots: PieceTableSnapshot[] = []
    for (let index = 0; index < 40; index++) {
      current = insertIntoPieceTable(current, 0, '!')
      snapshots.push(current)
    }
    const before = snapshots[0]!.buffers
    const job = reclaimSnapshotStorage(snapshots)
    while (snapshots[0]!.buffers === before) {
      if (job.next().done) break
    }
    job.return({ chunks: 0, codeUnits: 0, snapshots: 0 })
    expect(snapshots[0]!.buffers).not.toBe(before)
    expect(new Set(snapshots.map((snapshot) => bufferStorageIdentity(snapshot.buffers))).size).toBe(
      1,
    )
    for (const [index, snapshot] of snapshots.entries()) {
      expect(materializePieceTableFullText(snapshot)).toBe(
        '!'.repeat(index + 1) + 'prefix NEWsuffix',
      )
      expectValid(snapshot)
    }
  })

  test.each(['external-first', 'current-first'])(
    'keeps newline indexes independent after reclamation: %s',
    (order) => {
      const original = insertIntoPieceTable(
        createPieceTableSnapshot(''),
        0,
        'x'.repeat(BUFFER_CHUNK_SIZE),
      )
      const external = insertIntoPieceTable(original, original.length, 'a\n')
      const current = deleteFromPieceTable(external, 0, BUFFER_CHUNK_SIZE)
      expect(readPieceTableLine(current, 1)).toBe('')
      const job = reclaimSnapshotStorage([current])
      while (!job.next().done) {
        /* Finish publication before editing both logs. */
      }
      const appendExternal = () => insertIntoPieceTable(external, external.length, '\n')
      const appendCurrent = () => insertIntoPieceTable(current, current.length, 'b\n')
      const [first, second] =
        order === 'external-first'
          ? [appendExternal(), appendCurrent()]
          : [appendCurrent(), appendExternal()]
      const next = order === 'external-first' ? second : first
      expect(materializePieceTableFullText(next)).toBe('a\nb\n')
      expect([0, 1, 2].map((row) => readPieceTableLine(next, row))).toEqual(['a', 'b', ''])
      expect(offsetToPoint(first, first.length)).toEqual({ row: 2, column: 0 })
      expect(offsetToPoint(second, second.length)).toEqual({ row: 2, column: 0 })
      expectValid(first)
      expectValid(second)
    },
  )

  test('yields during cleanup even when every closed line index is discarded', () => {
    let buffers = createInitialBuffers('')
    const text = 'x'.repeat(BUFFER_CHUNK_SIZE - 1) + '\n'
    for (let chunk = 1; chunk <= 4096; chunk++) {
      buffers = appendChunksToBuffers(buffers, text).buffers
      buffers.lineIndexes.set(chunk, {
        offsets: new Uint32Array([text.length - 1]),
        count: 1,
        scannedLength: text.length,
      })
    }
    let visited = 0
    const iterate = buffers.lineIndexes[Symbol.iterator].bind(buffers.lineIndexes)
    vi.spyOn(buffers.lineIndexes, Symbol.iterator).mockImplementation(function* () {
      for (const entry of iterate()) {
        visited++
        yield entry
      }
    })
    const job = reclaimBufferGroup([buffers], new Map(), { chunks: 0, codeUnits: 0 })
    let largestBatch = 0
    let step: ReturnType<typeof job.next>
    do {
      const before = visited
      step = job.next()
      largestBatch = Math.max(largestBatch, visited - before)
    } while (!step.done)
    expect(visited).toBe(4096)
    expect(largestBatch).toBeLessThanOrEqual(256)
    expect(step.value.get(buffers)!.lineIndexes.size).toBe(1)
  })

  test('rejects consumed transient inputs', () => {
    const snapshot = createPieceTableSnapshot('abc', { transient: true })
    insertIntoPieceTable(snapshot, 1, 'x')
    expect(() => reclaimPieceTableText(snapshot)).toThrow('consumed transient snapshot')
  })

  test('the inspector rejects a visible piece whose text was reclaimed', () => {
    const { current, left } = retiredFixture()
    const compact = reclaimPieceTableText(current)
    const piece = flattenPieces(compact.root, []).find((item) => item.buffer === left.buffer)!
    const root = { ...compact.root!, piece: { ...piece, visible: true } }
    const issues = validatePieceTreeInvariants({ ...compact, root }).issues
    expect(issues.some((issue) => issue.field === 'retired.visible')).toBe(true)
  })

  test.each([41, 137, 60061])(
    'matches unreclaimed histories through churn and checkout, seed %i',
    (seed) => {
      let control = createPieceTableSnapshot('seed\n😀')
      let candidate = control
      const anchors = [anchorBefore(control, 1), anchorAfter(control, 1)]
      const retained: {
        control: PieceTableSnapshot
        candidate: PieceTableSnapshot
        text: string
      }[] = []
      let reclaims = 0
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed
      }
      for (let step = 0; step < 400; step++) {
        const from = random() % (control.length + 1)
        const token = step % 7 === 0 ? payload : '😀\nword'
        if (step % 3 === 0) {
          control = deleteFromPieceTable(control, 0, control.length)
          candidate = deleteFromPieceTable(candidate, 0, candidate.length)
        }
        if (step % 3 !== 0) {
          control = insertIntoPieceTable(control, from, token)
          candidate = insertIntoPieceTable(candidate, from, token)
        }
        const compact = reclaimPieceTableText(candidate)
        if (compact !== candidate) reclaims++
        candidate = compact
        expectEquivalent(control, candidate, anchors)
        if (step % 13 === 0) {
          anchors.push(anchorBefore(control, 0), anchorAfter(control, control.length))
          retained.push({ control, candidate, text: materializePieceTableFullText(control) })
        }
        if (step % 79 === 0 && retained.length > 1) {
          const old = retained[random() % retained.length]!
          control = old.control
          candidate = old.candidate
        }
      }
      expect(reclaims).toBeGreaterThan(20)
      for (const old of retained) {
        expect(materializePieceTableFullText(old.control)).toBe(old.text)
        expect(materializePieceTableFullText(old.candidate)).toBe(old.text)
        expectValid(old.candidate)
      }
    },
  )
})

function expectEquivalent(
  control: PieceTableSnapshot,
  candidate: PieceTableSnapshot,
  anchors: ReturnType<typeof anchorBefore>[],
) {
  expect(materializePieceTableFullText(candidate)).toBe(materializePieceTableFullText(control))
  for (const anchor of anchors)
    expect(resolveAnchor(candidate, anchor)).toEqual(resolveAnchor(control, anchor))
  expect(offsetToPoint(candidate, candidate.length)).toEqual(offsetToPoint(control, control.length))
  expectValid(candidate)
}
