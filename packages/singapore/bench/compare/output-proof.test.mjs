import { test } from 'node:test'
import assert from 'node:assert/strict'
import { outputProof, verifyOutputEquality } from './output-proof.mjs'
import { fixture, corpora } from './fixture.mjs'
import { fixtureIdentity } from './protocol.mjs'

test('canonical output hashes ignore palette numbering and include style and structural content', async () => {
  const output = (styles, styleIds) => ({
    tokensPacked: {
      starts: new Uint32Array([0, 4]),
      ends: new Uint32Array([3, 9]),
      styleIds: new Uint32Array(styleIds),
      styles,
    },
    records: { data: new Uint32Array([0, 9, 1]) },
    folds: [],
    brackets: [],
    errors: [],
    injections: [],
    statistics: { rangeEnd: 9, __compareCoverage: [{ kind: 'root', start: 0, end: 9 }] },
  })
  const previous = globalThis.__compareOpenProbe
  try {
    globalThis.__compareOpenProbe = {
      outputs: [output([{ color: 'red' }, { color: 'blue' }], [0, 1])],
    }
    const first = await outputProof()
    assert.equal(globalThis.__compareOpenProbe.outputs.length, 0)
    assert.deepEqual(await outputProof(), first)
    const current = output([{ color: 'blue' }, { color: 'red' }], [1, 0])
    globalThis.__compareOpenProbe.outputs = [current]
    assert.deepEqual(await outputProof(), first)
    globalThis.__compareOpenProbe.outputs = [current]
    current.tokensPacked.styles[1].color = 'green'
    assert.notEqual((await outputProof()).stylesSha256, first.stylesSha256)
    globalThis.__compareOpenProbe.outputs = [current]
    current.records.data[1] = 8
    assert.notEqual((await outputProof()).structuralSha256, first.structuralSha256)
    globalThis.__compareOpenProbe.outputs = [current]
    current.tokensPacked.ends[0] = 10
    await assert.rejects(outputProof(), /Invalid complete token stream/)
    globalThis.__compareOpenProbe.outputs = [current]
    current.tokensPacked.ends = new Uint32Array([3])
    await assert.rejects(outputProof(), /array lengths/)
  } finally {
    globalThis.__compareOpenProbe = previous
  }
})

test('qualification rejects missing, unequal and failed full outputs', () => {
  const row = {
    editor: 'singapore',
    mib: 1,
    status: 'ok',
    outputProof: {
      tokenCount: 2,
      tokenSha256: 'a',
      stylesSha256: 'b',
      structuralSha256: 'c',
      coverage: [],
    },
  }
  verifyOutputEquality([row, structuredClone(row)])
  assert.throws(
    () =>
      verifyOutputEquality([
        { ...row, startup: 'cold-context' },
        {
          ...row,
          startup: 'warm-runtime-fresh-document',
          outputProof: { ...row.outputProof, tokenSha256: 'd' },
        },
      ]),
    /Unequal/,
  )
  assert.throws(() => verifyOutputEquality([]), /no Singapore/)
  assert.throws(() => verifyOutputEquality([{ ...row, status: 'failed' }]), /failed/)
  assert.throws(() => verifyOutputEquality([{ ...row, outputProof: undefined }]), /proof/)
  assert.throws(
    () =>
      verifyOutputEquality([
        row,
        { ...row, outputProof: { ...row.outputProof, tokenSha256: 'd' } },
      ]),
    /Unequal/,
  )
})

test('corpora have deterministic UTF-16 lengths, portable identities and Unicode tails', () => {
  for (const corpus of corpora) {
    const text = fixture(1, corpus)
    assert.equal(text.length, 1024 * 1024)
    assert.equal(text, fixture(1, corpus))
    assert.ok(!/[\uD800-\uDBFF]$/.test(text))
    const identity = fixtureIdentity(1, corpus)
    assert.equal(identity.bytes, Buffer.byteLength(text))
    assert.equal(identity.utf16Length, text.length)
    assert.match(identity.sha256, /^[a-f0-9]{64}$/)
  }
  assert.ok(fixtureIdentity(1, 'unicode').bytes > fixtureIdentity(1, 'unicode').utf16Length)
})
