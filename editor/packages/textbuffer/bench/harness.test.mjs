import { beforeAll, describe, expect, it } from 'vitest'
import { applyOperation, loadAdapter, retentions } from './adapters.mjs'
import {
  applyOracle,
  indexLines,
  makeFixtures,
  normalizeInput,
  oraclePoint,
  oracleQuery,
  safeBoundary,
} from './fixtures.mjs'
import { optionsFrom } from './run.mjs'
import { consume, gitBlobHash, sha256, statistics } from './support.mjs'
import { prepareState, runOperations, validate } from './worker.mjs'

const fixtures = makeFixtures('smoke', 42)

function assertBuffer(buffer, expected) {
  expect(buffer.full()).toBe(expected)
  expect(buffer.length()).toBe(expected.length)
  const starts = indexLines(expected)
  expect(buffer.lineCount()).toBe(starts.length)
  for (let row = 0; row < starts.length; row += 1) {
    expect(buffer.line(row)).toBe(oracleQuery(expected, starts, { kind: 'line', row }))
  }
  const offsets = new Set([0, expected.length, Math.floor(expected.length / 2)])
  for (let index = 1; index < Math.min(expected.length, 12); index += 1) offsets.add(index)
  for (const offset of offsets) {
    const point = oraclePoint(starts, offset)
    expect(buffer.point(offset)).toEqual(point)
    expect(buffer.offset(point)).toBe(offset)
  }
}

for (const name of ['singapore', 'vscode'])
  describe(name + ' adapter contract', () => {
    let factory
    beforeAll(async () => {
      factory = await loadAdapter(name)
    })

    it.each([
      '',
      '\n',
      'abc',
      'abc\n',
      '\n\n',
      'שלום 😀e\u0301\t中\nlast',
      '\ufeffa\r\nb\rc\u2028d',
    ])('agrees with normalized string semantics for %j', (input) => {
      const expected = normalizeInput(input)
      assertBuffer(factory.create(expected), expected)
    })

    it.each(fixtures.filter((fixture) => fixture.mode === 'edit'))(
      'matches every intermediate edit in $name',
      (fixture) => {
        const buffer = factory.create(fixture.initial)
        let expected = fixture.initial
        for (const operation of fixture.operations) {
          if (operation.kind === 'offset') {
            expect(applyOperation(buffer, operation)).toEqual(
              oracleQuery(expected, indexLines(expected), operation),
            )
            continue
          }
          const edits = operation.kind === 'batch' ? operation.edits : [operation]
          for (const edit of edits) {
            expect(edit.from).toBeGreaterThanOrEqual(0)
            expect(edit.to).toBeLessThanOrEqual(expected.length)
            expect(edit.to).toBeGreaterThanOrEqual(edit.from)
            expect(safeBoundary(expected, edit.from)).toBe(edit.from)
            expect(safeBoundary(expected, edit.to)).toBe(edit.to)
          }
          expected = applyOracle(expected, operation)
          applyOperation(buffer, operation)
          assertBuffer(buffer, expected)
        }
        expect(expected).toBe(fixture.expected)
        expect(buffer.issues()).toEqual([])
      },
    )

    it.each(fixtures.filter((fixture) => fixture.mode === 'query'))(
      'checks exact results and consumption for $name',
      (fixture) => {
        const buffer = factory.create(fixture.initial)
        for (const operation of fixture.setup) applyOperation(buffer, operation)
        const starts = indexLines(fixture.expected)
        let checksum = 2166136261
        for (const operation of fixture.operations) {
          const actual = applyOperation(buffer, operation)
          expect(actual).toEqual(oracleQuery(fixture.expected, starts, operation))
          checksum = consume(actual, checksum)
        }
        expect(checksum).toBe(fixture.expectedDigest)
      },
    )

    it('rejects broken reads even when a supplied checksum looks correct', () => {
      const fixture = fixtures.find((item) => item.name === 'ranges-after-churn')
      const buffer = factory.create(fixture.initial)
      for (const operation of fixture.setup) applyOperation(buffer, operation)
      buffer.range = () => 'incorrect'
      expect(() =>
        validate(factory, fixture, { buffer, checksum: fixture.expectedDigest }),
      ).toThrow()
    })

    it('does not hide dropped edits behind the benchmark timer', () => {
      const fixture = fixtures.find((item) => item.name === 'random-insertions')
      const buffer = factory.create(fixture.initial)
      expect(() => validate(factory, fixture, { buffer })).toThrow()
    })
  })

describe('persistent-only semantics', () => {
  it('retains roots and deleted anchor bias across replacement and restoration', async () => {
    const factory = await loadAdapter('singapore')
    const buffer = factory.create('abcd')
    const before = buffer.retain()
    const left = buffer.anchor(2, 'left')
    const right = buffer.anchor(2, 'right')
    buffer.edit({ from: 1, to: 3, text: 'XY' })
    expect(buffer.full()).toBe('aXYd')
    expect(buffer.resolve(left)).toEqual({ offset: 1, liveness: 'deleted' })
    expect(buffer.resolve(right)).toEqual({ offset: 3, liveness: 'deleted' })
    const restored = factory.restore(before)
    expect(restored.full()).toBe('abcd')
    expect(restored.resolve(left)).toEqual({ offset: 2, liveness: 'live' })
    restored.edit({ from: 0, to: 0, text: 'branch:' })
    expect(factory.retainedText(before)).toBe('abcd')
    expect(buffer.full()).toBe('aXYd')
  })

  it('does not pretend the mutable adapter supports persistent branches', async () => {
    const factory = await loadAdapter('vscode')
    expect(factory.restore).toBeUndefined()
    expect(factory.create('abc').retain).toBeUndefined()
  })
})

describe('reproducibility and reporting', () => {
  it('replays the same fixture identities for a seed and changes edit traces for another', () => {
    expect(sha256(JSON.stringify(makeFixtures('smoke', 42)))).toBe(sha256(JSON.stringify(fixtures)))
    expect(sha256(JSON.stringify(makeFixtures('smoke', 43)))).not.toBe(
      sha256(JSON.stringify(fixtures)),
    )
  })

  it('detects modified source bytes using Git blob identity', () => {
    expect(gitBlobHash(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    expect(gitBlobHash(Buffer.from('hello!\n'))).not.toBe(gitBlobHash(Buffer.from('hello\n')))
  })

  it('reports nearest-rank p95 and the correct even-sample median', () => {
    expect(statistics([4, 1, 3, 2])).toEqual({
      count: 4,
      min: 1,
      median: 2.5,
      p95: 4,
      max: 4,
      mean: 2.5,
    })
    expect(statistics(Array.from({ length: 20 }, (_, index) => index + 1)).p95).toBe(19)
    expect(() => statistics([])).toThrow()
    expect(() => statistics([NaN])).toThrow()
  })

  it.each([
    ['--samples', '0'],
    ['--samples', 'NaN'],
    ['--warmups', '-1'],
    ['--profile', 'unknown'],
    ['--seed'],
    ['--oops', '1'],
  ])('rejects malformed options %j', (...args) => {
    expect(() => optionsFrom(args)).toThrow()
  })

  it('keeps the common CRLF/Unicode input contract explicit', () => {
    expect(normalizeInput('\ufeffa\r\nb\rc\u2028d\u2029')).toBe('a\nb\nc\nd\n')
    expect(safeBoundary('a😀b', 2)).toBe(1)
    expect(safeBoundary('a😀b', 3)).toBe(3)
  })
})

// Retention decides what an edit may mutate in place. Every lane must still
// validate under every mode: a root retained before an in-place edit reads
// its own text afterwards, and branch-edits retains before every branch.
describe('retention modes', () => {
  for (const retention of retentions) {
    it(`validates every smoke workload with ${retention} retention`, async () => {
      const factory = await loadAdapter('singapore', {}, retention)
      expect(factory.retention).toBe(retention)
      for (const fixture of fixtures) {
        const context = fixture.mode === 'load' ? null : prepareState(factory, fixture)
        const result = runOperations(factory, fixture, context)
        validate(factory, fixture, result)
      }
    })
  }

  it('refuses a second edit of a transient snapshot that was never retained', async () => {
    const factory = await loadAdapter('singapore', {}, 'history')
    const buffer = factory.create('abc')
    const stale = buffer.snapshot
    buffer.edit({ from: 1, to: 1, text: 'X' })
    expect(buffer.full()).toBe('aXbc')
    expect(() => factory.restore(stale).edit({ from: 0, to: 0, text: 'Y' })).toThrow(
      /already edited in place/,
    )
  })
})
