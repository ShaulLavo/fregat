import { describe, expect, test } from 'vitest'
import {
  anchorAt,
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  resolveAnchor,
  resolveAnchorLinear,
} from './index'
import { compactPieceTableTombstones, compactTombstones } from './compaction'
import { validatePieceTreeInvariants } from './inspection'
import type {
  PieceTableEdit,
  PieceTableSnapshot,
  PieceTreeNode,
  RealAnchor,
} from './pieceTableTypes'
import { createNode } from './node'
import { buildReverseIndex } from './reverseIndex'
import { createSnapshot } from './snapshot'
import { flattenPieces } from './tree'

const randomSource = (seed: number) => {
  let state = seed >>> 0
  return (limit: number): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % limit
  }
}

const tokens = ['x', 'hello ', '\n', '😀', 'paste me in here ', 'ab\ncd', '\ud83d']

const expectValid = (snapshot: PieceTableSnapshot): void => {
  expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])
}

type Job = ReturnType<typeof compactTombstones>

// Steps a pass partway, as maintenance does between slices.
const startCompaction = (snapshot: PieceTableSnapshot, steps: number): Job | null => {
  const job = compactTombstones(snapshot)
  for (let step = 0; step < steps; step++) {
    const next = job.next()
    if (!next.done) continue
    expect(next.value.unverified).toBe(0)
    return null
  }
  return job
}

const finishCompaction = (job: Job | null): void => {
  if (!job) return
  for (let next = job.next(); ; next = job.next()) {
    if (!next.done) continue
    expect(next.value.unverified).toBe(0)
    return
  }
}

const compact = (snapshot: PieceTableSnapshot) => {
  const result = compactPieceTableTombstones(snapshot)
  expect(result.unverified).toBe(0)
  return result
}

const churn = (snapshot: PieceTableSnapshot, at: number, text: string): PieceTableSnapshot =>
  deleteFromPieceTable(insertIntoPieceTable(snapshot, at, text), at, text.length)

describe('compacting a run of tombstones', () => {
  test('one paragraph replaced over and over leaves a bounded run', () => {
    let snapshot = createPieceTableSnapshot('prefix suffix')
    const anchors: RealAnchor[] = []
    for (let cycle = 0; cycle < 400; cycle++) {
      snapshot = insertIntoPieceTable(snapshot, 7, `paragraph ${cycle}\n`)
      anchors.push(anchorAt(snapshot, 9, 'left'), anchorAt(snapshot, 9, 'right'))
      snapshot = deleteFromPieceTable(snapshot, 7, `paragraph ${cycle}\n`.length)
    }
    const before = anchors.map((anchor) => resolveAnchor(snapshot, anchor))
    expect(snapshot.pieceCount).toBe(402)

    const result = compact(snapshot)
    expect(result.runs).toBe(1)
    expect(snapshot.pieceCount).toBeLessThanOrEqual(4)
    expect(anchors.map((anchor) => resolveAnchor(snapshot, anchor))).toEqual(before)
    expect(materializePieceTableFullText(snapshot)).toBe('prefix suffix')
    expectValid(snapshot)

    // New text in the gap still lands where bias says, for anchors of every age.
    const typed = insertIntoPieceTable(snapshot, 7, 'NEW')
    for (const [at, anchor] of anchors.entries()) {
      expect(resolveAnchor(typed, anchor)).toEqual({
        offset: at % 2 === 0 ? 7 : 10,
        liveness: 'deleted',
      })
    }
  })

  test('keeps the snapshot object, its text and every visible piece', () => {
    let snapshot = createPieceTableSnapshot('one two three four')
    for (let cycle = 0; cycle < 20; cycle++) snapshot = churn(snapshot, 4, 'abc')
    const identity = snapshot
    const length = snapshot.length
    compact(snapshot)
    expect(snapshot).toBe(identity)
    expect(snapshot.length).toBe(length)
    expect(materializePieceTableFullText(snapshot)).toBe('one two three four')
    expectValid(snapshot)
  })

  test('deleted original text keeps original offsets resolving', () => {
    let snapshot = createPieceTableSnapshot('0123456789abcdefghij')
    const anchors = [3, 4, 5, 6, 7, 8, 12].flatMap((at) => [
      anchorAt(snapshot, at, 'left'),
      anchorAt(snapshot, at, 'right'),
    ])
    snapshot = deleteFromPieceTable(snapshot, 3, 2)
    snapshot = insertIntoPieceTable(snapshot, 3, 'X')
    snapshot = deleteFromPieceTable(snapshot, 3, 1)
    snapshot = deleteFromPieceTable(snapshot, 3, 3)
    snapshot = insertIntoPieceTable(snapshot, 3, 'YY')
    snapshot = deleteFromPieceTable(snapshot, 3, 2)
    const before = anchors.map((anchor) => resolveAnchor(snapshot, anchor))
    compact(snapshot)
    expect(anchors.map((anchor) => resolveAnchor(snapshot, anchor))).toEqual(before)
    expectValid(snapshot)
  })
})

describe('where text lands', () => {
  // The same pieces under every root: an insert must land in one place and
  // every deleted anchor must resolve alike, whatever the tree's shape.
  test('an insert beside two tombstones does not depend on the tree shape', () => {
    let snapshot = createPieceTableSnapshot('prefix suffix')
    snapshot = insertIntoPieceTable(snapshot, 7, 'AAA')
    const anchors = [anchorAt(snapshot, 8, 'left'), anchorAt(snapshot, 8, 'right')]
    snapshot = deleteFromPieceTable(snapshot, 7, 3)
    snapshot = insertIntoPieceTable(snapshot, 7, 'BBB')
    anchors.push(anchorAt(snapshot, 8, 'left'), anchorAt(snapshot, 8, 'right'))
    snapshot = deleteFromPieceTable(snapshot, 7, 3)
    const pieces = flattenPieces(snapshot.root, [])
    const results = new Set<string>()
    for (let rootAt = 0; rootAt < pieces.length; rootAt++) {
      const chain = (from: number, to: number): PieceTreeNode | null => {
        if (from >= to) return null
        const at = from === 0 && to === pieces.length ? rootAt : (from + to) >>> 1
        return createNode(pieces[at]!, chain(from, at), chain(at + 1, to))
      }
      const root = chain(0, pieces.length)
      const shaped = createSnapshot(snapshot.buffers, root, buildReverseIndex(root))
      const typed = insertIntoPieceTable(shaped, 7, 'N')
      const sequence = flattenPieces(typed.root, []).map((piece) => piece.buffer)
      results.add(JSON.stringify([sequence, anchors.map((anchor) => resolveAnchor(typed, anchor))]))
    }
    expect(results.size).toBe(1)
    expect([...results][0]).toContain('"offset":7')
  })
})

describe('compaction between edits', () => {
  test('order normalization next to stand-ins keeps their entries', () => {
    // Anchors inside each churned insert, taken before it is deleted, can only
    // resolve through the entries that lead to stand-ins.
    const anchors: RealAnchor[] = []
    const build = (hold: boolean) => {
      let snapshot = createPieceTableSnapshot('ab')
      for (let cycle = 0; cycle < 30; cycle++) {
        const text = `deleted ${cycle}`
        snapshot = insertIntoPieceTable(snapshot, 1, text)
        if (hold) anchors.push(anchorAt(snapshot, 4, 'left'), anchorAt(snapshot, 4, 'right'))
        snapshot = deleteFromPieceTable(snapshot, 1, text.length)
      }
      return snapshot
    }
    let control = build(true)
    let candidate = build(false)
    compact(candidate)
    // Inserting at one spot halves the same order gap until none is left.
    let relabels = 0
    for (let edit = 0; edit < 200; edit++) {
      control = insertIntoPieceTable(control, 1, `${edit % 10}`)
      const before = candidate.root
      candidate = insertIntoPieceTable(candidate, 1, `${edit % 10}`)
      if (flattenPieces(candidate.root, []).every((piece) => piece.order % 1024 === 0)) relabels++
      if (before && edit % 50 === 49) compact(candidate)
    }
    expect(relabels).toBeGreaterThan(0)
    for (const anchor of anchors) {
      const resolved = resolveAnchor(candidate, anchor)
      expect(resolved.liveness).toBe('deleted')
      expect(resolved).toEqual(resolveAnchor(control, anchor))
    }
    expectValid(candidate)
  })

  test('a transient lineage edits a compacted snapshot by copying its nodes', () => {
    const options = { transient: true }
    let control = createPieceTableSnapshot('transient text here', options)
    let candidate = createPieceTableSnapshot('transient text here', options)
    const anchors: RealAnchor[] = []
    for (let cycle = 0; cycle < 60; cycle++) {
      control = insertIntoPieceTable(control, 10, `t${cycle}`)
      candidate = insertIntoPieceTable(candidate, 10, `t${cycle}`)
      anchors.push(anchorAt(control, 11, 'left'), anchorAt(control, 11, 'right'))
      control = deleteFromPieceTable(control, 10, `t${cycle}`.length)
      candidate = deleteFromPieceTable(candidate, 10, `t${cycle}`.length)
      if (cycle % 7 === 6) compact(candidate)
    }
    for (const anchor of anchors) {
      expect(resolveAnchor(candidate, anchor)).toEqual(resolveAnchor(control, anchor))
    }
    expectValid(candidate)
  })

  test('churn at several spots stays bounded by the spots, not the cycles', () => {
    let snapshot = createPieceTableSnapshot('alpha beta gamma delta epsilon\n'.repeat(8))
    const counts: number[] = []
    for (let cycle = 0; cycle < 2000; cycle++) {
      const at = [3, 40, 90, 150, 200][cycle % 5]!
      snapshot = churn(snapshot, at, cycle % 3 ? 'word ' : 'a whole line\n')
      if (cycle % 100 === 99) {
        compact(snapshot)
        counts.push(snapshot.pieceCount)
      }
    }
    expect(Math.max(...counts)).toBeLessThanOrEqual(counts[0]!)
    expect(Math.max(...counts)).toBeLessThan(40)
  })
})

// Thread CPU time, so other work on the machine cannot fail a step. A major GC
// lands in whichever step trips it, often collecting an earlier test's heap, so
// its pause is subtracted.
const cpuMs = (): number => {
  const usage = process.threadCpuUsage()
  return (usage.user + usage.system) / 1000
}

const longestStepMs = async (step: () => boolean): Promise<number> => {
  const pauses: PerformanceEntry[] = []
  const observer = new PerformanceObserver((list) => pauses.push(...list.getEntries()))
  observer.observe({ entryTypes: ['gc'] })
  const timed: { start: number; end: number; cpu: number }[] = []
  for (let done = false; !done;) {
    const start = performance.now()
    const cpu = cpuMs()
    done = step()
    timed.push({ start, end: performance.now(), cpu: cpuMs() - cpu })
  }
  // GC entries reach the observer on a later tick.
  await new Promise((resolve) => setTimeout(resolve, 20))
  observer.disconnect()
  const paused = (from: number, to: number) =>
    pauses
      .filter((pause) => pause.startTime >= from && pause.startTime < to)
      .reduce((sum, pause) => sum + pause.duration, 0)
  return Math.max(...timed.map(({ start, end, cpu }) => cpu - paused(start, end)))
}

describe('work proportional to the tree, not the history', () => {
  const churnAtOneSpot = (cycles: number, passEvery: number) => {
    let snapshot = createPieceTableSnapshot('ab')
    const passSteps: number[] = []
    for (let cycle = 1; cycle <= cycles; cycle++) {
      snapshot = deleteFromPieceTable(
        insertIntoPieceTable(snapshot, 1, `p${cycle}`),
        1,
        `p${cycle}`.length,
      )
      if (cycle % passEvery !== 0) continue
      const job = compactTombstones(snapshot)
      let steps = 0
      while (!job.next().done) steps++
      passSteps.push(steps)
    }
    return { snapshot, passSteps }
  }

  // Relabelling runs inside an edit. After a long compacted history it once
  // rebuilt an entry per insertion ever made: 45 ms at 100,000 of them.
  test('a relabel after a long history touches only the live tree', async () => {
    let { snapshot } = churnAtOneSpot(50_000, 2000)
    expect(snapshot.pieceCount).toBeLessThan(200)
    let edit = 0
    const longest = await longestStepMs(() => {
      snapshot = insertIntoPieceTable(snapshot, 1, `${edit % 10}`)
      return ++edit === 120
    })
    expect(longest).toBeLessThan(8)
    expectValid(snapshot)
  }, 60_000)

  // Maintenance runs every few thousand insertions on a tree that stays small.
  // Walking the whole index each time grew a pass from 42 to 794 steps.
  test('a pass costs the same late in a long history as early on', () => {
    const { passSteps } = churnAtOneSpot(100_000, 4096)
    const early = passSteps[1]!
    expect(Math.max(...passSteps.slice(1))).toBeLessThan(2 * early)
  }, 60_000)

  // Fragmented buffers the pass does not compact must cost it nothing.
  test('a pass does not read the entries of fragments it leaves alone', async () => {
    let snapshot = createPieceTableSnapshot('fragments: ')
    for (let paste = 0; paste < 64; paste++) {
      const at = snapshot.length
      snapshot = insertIntoPieceTable(snapshot, at, 'x'.repeat(16 * 1024))
      const holes = Array.from({ length: 8 * 1024 }, (_, hole) => ({
        from: at + 2 * hole,
        to: at + 2 * hole + 1,
        text: '',
      }))
      snapshot = applyBatchToPieceTable(snapshot, holes)
    }
    for (let cycle = 0; cycle < 50; cycle++) snapshot = churn(snapshot, 3, `churn ${cycle}`)
    const job = compactTombstones(snapshot)
    const longest = await longestStepMs(() => {
      const step = job.next()
      if (step.done) expect(step.value.runs).toBe(1)
      return step.done === true
    })
    expect(longest).toBeLessThan(8)
    expectValid(snapshot)
  }, 60_000)
})

describe('maintenance latency', () => {
  // Each cycle's deleted text is blocked by a different visible append, so one
  // trailing run holds a stand-in per cycle. Checking it once took 68 ms here.
  test('a long run of distinct stand-ins is planned in short steps', async () => {
    let snapshot = createPieceTableSnapshot('')
    let longest = 0
    let steps = 0
    for (let cycle = 0; snapshot.length < 8000; cycle++) {
      snapshot = insertIntoPieceTable(snapshot, snapshot.length, 'x')
      for (let twice = 0; twice < 2; twice++) {
        snapshot = insertIntoPieceTable(snapshot, snapshot.length, 'y')
        snapshot = deleteFromPieceTable(snapshot, snapshot.length - 1, 1)
      }
      if (cycle % 1000 !== 999) continue
      const job = compactTombstones(snapshot)
      steps = 0
      const passLongest = await longestStepMs(() => {
        steps++
        const step = job.next()
        if (step.done) expect(step.value.unverified).toBe(0)
        return step.done === true
      })
      longest = Math.max(longest, passLongest)
    }
    // The last pass saw about 8,000 stand-ins and 2,000 new tombstones in one run.
    expect(steps).toBeGreaterThan(10_000 / 1024)
    expect(longest).toBeLessThan(16)
  }, 30_000)
})

type State = {
  readonly control: PieceTableSnapshot
  readonly candidate: PieceTableSnapshot
  readonly parent: State | null
}

type Held = { readonly anchor: RealAnchor; readonly origin: State }

const lineage = (state: State): Set<State> => {
  const states = new Set<State>()
  for (let at: State | null = state; at; at = at.parent) states.add(at)
  return states
}

const randomEdit = (
  random: (limit: number) => number,
  length: number,
  hot: number,
): PieceTableEdit[] => {
  const token = () => tokens[random(tokens.length)]!
  const kind = random(10)
  if (kind < 3) return [{ from: Math.min(hot, length), to: Math.min(hot, length), text: token() }]
  if (kind < 5) {
    const from = random(length + 1)
    return [{ from, to: from, text: token() }]
  }
  if (kind < 7) {
    const from = random(length + 1)
    return [{ from, to: Math.min(length, from + 1 + random(24)), text: '' }]
  }
  if (kind < 9) {
    const from = random(length + 1)
    return [{ from, to: Math.min(length, from + random(12)), text: token() }]
  }
  const first = random(length + 1)
  const second = Math.min(length, first + random(8))
  return [
    { from: first, to: first, text: token() },
    { from: second, to: Math.min(length, second + random(6)), text: random(2) ? token() : '' },
  ]
}

const expectSameResolution = (
  state: State,
  anchors: readonly Held[],
  label: string,
  linear: boolean,
): void => {
  for (const { anchor } of anchors) {
    const expected = resolveAnchor(state.control, anchor)
    expect(resolveAnchor(state.candidate, anchor), `${label} ${JSON.stringify(anchor)}`).toEqual(
      expected,
    )
    if (linear) {
      expect(resolveAnchorLinear(state.candidate, anchor), `${label} linear`).toEqual(expected)
    }
  }
}

// The candidate is compacted at random points, the control never. Both see the
// same edits, so every anchor must resolve alike in both after every step.
const runDifferential = (seed: number, steps: number, text: string): void => {
  const random = randomSource(seed)
  let state: State = {
    control: createPieceTableSnapshot(text),
    candidate: createPieceTableSnapshot(text),
    parent: null,
  }
  const history: State[] = [state]
  let anchors: Held[] = []
  let hot = 17
  let pending: Job | null = null
  for (let step = 1; step <= steps; step++) {
    for (let made = 0; made < 2; made++) {
      const at = random(state.control.length + 1)
      const bias = random(2) ? 'left' : 'right'
      const anchor = anchorAt(state.control, at, bias)
      expect(anchorAt(state.candidate, at, bias)).toEqual(anchor)
      anchors.push({ anchor, origin: state })
    }
    if (random(40) === 0) hot = random(state.control.length + 1)
    const edits = randomEdit(random, state.control.length, hot)
    state = {
      control: applyBatchToPieceTable(state.control, edits),
      candidate: applyBatchToPieceTable(state.candidate, edits),
      parent: state,
    }
    const label = `seed ${seed} step ${step} ${JSON.stringify(edits)}`
    // A pass begun before this edit publishes on the state it began on.
    finishCompaction(pending)
    if (pending) expectSameResolution(state.parent!, anchors, `${label} pass after edit`, false)
    pending = null
    expect(materializePieceTableFullText(state.candidate), label).toBe(
      materializePieceTableFullText(state.control),
    )
    // oxlint-disable-next-line no-dupe-else-if -- random() draws again on each call
    if (random(6) === 0) compact(state.candidate)
    else if (random(6) === 0) pending = startCompaction(state.candidate, random(40))
    expectSameResolution(state, anchors, label, step % 20 === 0)
    history.push(state)

    // Undo to an older state and carry on from there. Anchors made on the
    // abandoned branch name buffers the new branch will number again.
    if (random(30) === 0) {
      finishCompaction(pending)
      pending = null
      state = history[random(history.length)]!
      if (random(2)) compact(state.candidate)
      const kept = lineage(state)
      anchors = anchors.filter((held) => kept.has(held.origin))
      expectSameResolution(state, anchors, `${label} after undo`, false)
    }
    if (anchors.length > 400) anchors = anchors.filter((_, at) => at % 2 === 0)
  }
  compact(state.candidate)
  expectSameResolution(state, anchors, `seed ${seed} final`, true)
  expectValid(state.candidate)
}

describe('deleted anchors against an uncompacted control', () => {
  test.each(Array.from({ length: 16 }, (_, at) => at + 1))(
    'resolve alike after every edit, seed %i',
    (seed) => runDifferential(seed, 400, 'const value = "original text";\n'.repeat(4)),
    60_000,
  )

  test.each([101, 102])(
    'resolve alike over a long surrogate-heavy session, seed %i',
    (seed) => runDifferential(seed, 1500, '😀 a\nb 😀'.repeat(12)),
    120_000,
  )
})
