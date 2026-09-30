import assert from 'node:assert/strict'
import { applyOracle, makeFixtures, randomSource, safeBoundary } from './fixtures.mjs'
import { sha256 } from './support.mjs'

export const stressNames = [
  'prepend',
  'fixed-middle',
  'alternating-ends',
  'hotspot-churn',
  'shrinking-churn',
]

export function makeHeightFixtures(profile, traceSeed, stressEdits) {
  assert(Number.isSafeInteger(stressEdits) && stressEdits > 0, 'Invalid stress edit count')
  // Height replays edits only; a lookup between keystrokes changes no tree.
  const shared = makeFixtures(profile, traceSeed).filter(
    (fixture) =>
      fixture.mode === 'edit' &&
      fixture.operations.every((operation) => operation.kind !== 'offset'),
  )
  return shared.concat(stressNames.map((name) => stressFixture(name, traceSeed, stressEdits)))
}

function stressFixture(name, seed, count) {
  const initial = 'abcdefghij\n'.repeat(100)
  const random = randomSource(seed)
  const tokens = ['x', '\n', 'hello', '😀', 'שלום', 'e\u0301']
  const operations = []
  let text = initial
  const fixed = Math.floor(initial.length / 2)
  for (let index = 0; index < count; index += 1) {
    let from = 0
    let to = 0
    let inserted = tokens[random(tokens.length)]
    if (name === 'fixed-middle' || name === 'hotspot-churn') {
      from = safeBoundary(text, Math.min(fixed, text.length))
      if (name === 'hotspot-churn' && index % 2) {
        to = from + operations[index - 1].text.length
        inserted = ''
      } else to = from
    } else if (name === 'alternating-ends') {
      from = index % 2 ? text.length : 0
      to = from
    } else if (name === 'shrinking-churn') {
      from = safeBoundary(text, random(text.length + 1))
      to = safeBoundary(text, Math.min(text.length, from + 1 + random(24)))
      if (index % 3) inserted = ''
    }
    const operation = { kind: 'edit', from, to, text: inserted }
    text = applyOracle(text, operation)
    operations.push(operation)
  }
  return { name, initial, operations, expected: text }
}

export function fixtureHash(fixture) {
  return sha256(JSON.stringify({ initial: fixture.initial, operations: fixture.operations }))
}

export function samplePoints(count, every) {
  assert(Number.isSafeInteger(every) && every > 0, 'Invalid sampling interval')
  const points = new Set([0, count])
  for (let at = 1; at < count; at *= 2) points.add(at)
  for (let at = every; at < count; at += every) points.add(at)
  return points
}
