import assert from 'node:assert/strict'
import { epochNanoseconds, type IntervalBlock } from './ghostty-x6-public-overlap.ts'
import { x6Protocol } from './ghostty-x6-public-statistics.ts'

export function verifyX6Slices(block: IntervalBlock): void {
  const clock = block.clock
  assert(clock && clock.anchors.length >= 2, 'Actual before/after clock mapping required')
  const origin = epochNanoseconds(clock.timeOriginMilliseconds)
  assert.equal(String(origin), clock.timeOriginNanoseconds)
  for (const row of block.rows) {
    const lifecycle = row.operation === 'public-use-fresh' || row.operation === 'public-dispose'
    assert(row.slices, 'Actual stopwatch slices required; no envelope substitution')
    assert.equal(row.slices.length, lifecycle ? x6Protocol.operationsPerObservation : 1)
    if (lifecycle) assert.equal(row.operations, x6Protocol.operationsPerObservation)
    let milliseconds = 0
    let previousEnd = -Infinity
    for (const slice of row.slices) {
      const start = slice.startedAtMonotonicMilliseconds
      const end = slice.endedAtMonotonicMilliseconds
      assert(Number.isFinite(start) && Number.isFinite(end) && end > start)
      assert(start >= previousEnd, 'Ordered nonoverlapping stopwatch slices required')
      const mappedStart = origin + epochNanoseconds(start)
      const mappedEnd = origin + epochNanoseconds(end)
      assert(mappedEnd > mappedStart, 'Unresolved rounded slice; retain raw input and stop')
      assert.equal(String(mappedStart), slice.startedAtNanoseconds)
      assert.equal(String(mappedEnd), slice.endedAtNanoseconds)
      previousEnd = end
      milliseconds += end - start
    }
    assert.equal(row.milliseconds, milliseconds, 'Recorded sum must include every actual slice')
    assert(
      row.slices[0]!.startedAtMonotonicMilliseconds >=
        clock.anchors[0]!.beforeMonotonicMilliseconds,
    )
    assert(
      row.slices.at(-1)!.endedAtMonotonicMilliseconds <=
        clock.anchors.at(-1)!.afterMonotonicMilliseconds,
    )
  }
}
