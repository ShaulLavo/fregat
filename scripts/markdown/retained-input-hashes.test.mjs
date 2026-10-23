import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'vitest'
import { decodeInputs, recoverInputs, selectedString } from './retained-input-hashes.mjs'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const field = { pointer: '/source', group: 'regressions', certainty: 'exact-retained-input' }

test('hashes exact decoded strings and preserves all nine groups', () => {
  const source = '\ufeffA\r\n\ud800é\udc00\n'
  const bytes = Buffer.from(JSON.stringify({ source }))
  const entry = {
    file: 'fixture.json',
    sha256: sha256(bytes),
    format: 'json',
    fields: [field, field],
  }
  const result = recoverInputs({ complete: false, inputs: [entry] }, () => bytes)
  assert.equal(result.inventory.complete, false)
  assert.equal(result.inventory.groups.length, 9)
  assert.equal(result.records.length, 2)
  assert.deepEqual(result.inventory.groups[5].sourceSha256, [sha256(source)])
  assert.equal(result.records[0].utf16Units, source.length)
  assert(!JSON.stringify(result).includes('é'))
})

test('rejects changed artifacts and unsupported completeness declarations', () => {
  const entry = { file: 'fixture.json', sha256: '0'.repeat(64), format: 'json', fields: [field] }
  assert.throws(
    () => recoverInputs({ complete: false, inputs: [entry] }, () => Buffer.from('{}')),
    /bytes changed/,
  )
  assert.throws(() => recoverInputs({ complete: true, inputs: [] }), /completeness/)
})

test('JSON pointers decode keys and reject absent, inherited, or non-string values', () => {
  assert.equal(selectedString({ 'a/b': { '~': 'exact' } }, '/a~1b/~0'), 'exact')
  assert.throws(() => selectedString({}, '/constructor'), /Missing/)
  assert.throws(() => selectedString({ source: null }, '/source'), /string/)
  assert.throws(() => selectedString({}, '/source'), /Missing/)
})

test('JSONL pointers use physical lines and preserve escaped newlines', () => {
  const bytes = Buffer.from('\n{"source":"A\\nB"}\n')
  const entry = { format: 'jsonl', fields: [{ ...field, pointer: 'line:2/source' }] }
  assert.equal(decodeInputs(bytes, entry)[0].source, 'A\nB')
  assert.throws(() => decodeInputs(bytes, { format: 'jsonl', fields: [field] }), /physical line/)
})

test('raw UTF-16 preserves isolated units and UTF-8 preserves BOM and line endings', () => {
  const source = '\ud800A\udc00\r\n'
  assert.equal(
    decodeInputs(Buffer.from(source, 'utf16le'), { format: 'utf16le' })[0].source,
    source,
  )
  assert.throws(() => decodeInputs(Buffer.from([0]), { format: 'utf16le' }), /code units/)
  assert.equal(
    decodeInputs(Buffer.from('\ufeffA\r\n'), { format: 'utf8' })[0].source,
    '\ufeffA\r\n',
  )
  assert.throws(() => decodeInputs(Buffer.from([255]), { format: 'utf8' }))
})

test('raw artifact bytes determine the source even if plan metadata contains source', () => {
  const decoded = decodeInputs(Buffer.from('actual bytes'), {
    format: 'utf8',
    source: 'metadata',
  })
  assert.equal(decoded[0].source, 'actual bytes')
})
