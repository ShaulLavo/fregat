import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const GROUPS = [
  'commonmark',
  'gfm',
  'chat',
  'owned-cases',
  'repositories',
  'regressions',
  'messages',
  'stories',
  'workloads',
]
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const encode = (value) => JSON.stringify(value, null, 2) + '\n'

export function selectedString(value, pointer) {
  assert.equal(typeof pointer, 'string')
  assert(pointer.startsWith('/'))
  let selected = value
  for (const escaped of pointer.slice(1).split('/')) {
    const key = escaped.replaceAll('~1', '/').replaceAll('~0', '~')
    assert(
      selected !== null && typeof selected === 'object' && Object.hasOwn(selected, key),
      'Missing exact input pointer',
    )
    selected = selected[key]
  }
  assert.equal(typeof selected, 'string', 'Selected input must be a string')
  return selected
}

function jsonlString(lines, pointer, parsed) {
  const match = /^line:([1-9][0-9]*)(\/.*)$/.exec(pointer)
  assert(match, 'JSONL pointer requires a physical line number')
  const line = lines[Number(match[1]) - 1]
  assert(line?.trim(), 'Selected JSONL line must contain a record')
  const number = Number(match[1])
  if (!parsed.has(number)) parsed.set(number, JSON.parse(line))
  return selectedString(parsed.get(number), match[2])
}

export function decodeInputs(bytes, entry) {
  if (entry.format === 'utf8')
    return [
      {
        ...entry,
        source: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
        pointer: '/',
      },
    ]
  if (entry.format === 'utf16le') {
    assert.equal(bytes.length % 2, 0, 'UTF-16 input requires complete code units')
    return [{ ...entry, source: bytes.toString('utf16le'), pointer: '/' }]
  }
  assert(entry.format === 'json' || entry.format === 'jsonl', 'Unknown retained input format')
  assert(
    Array.isArray(entry.fields) && entry.fields.length > 0,
    'JSON inputs require explicit string pointers',
  )
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  const value = entry.format === 'json' ? JSON.parse(text) : text.split('\n')
  const parsed = new Map()
  return entry.fields.map((field) => ({
    ...field,
    source:
      entry.format === 'json'
        ? selectedString(value, field.pointer)
        : jsonlString(value, field.pointer, parsed),
  }))
}

function inputRecord(input, entry) {
  assert(GROUPS.includes(input.group), 'Unknown exclusion group')
  assert(
    typeof input.certainty === 'string' && input.certainty.length > 0,
    'Every hash requires a disposition',
  )
  return {
    group: input.group,
    sourceSha256: sha256(input.source),
    file: entry.file,
    fileSha256: entry.sha256,
    pointer: input.pointer,
    format: entry.format,
    certainty: input.certainty,
    utf16Units: input.source.length,
    utf8Bytes: Buffer.byteLength(input.source),
  }
}

export function recoverInputs(plan, read = readFileSync) {
  assert.equal(plan.complete, false, 'Recovery cannot declare historical completeness')
  assert(Array.isArray(plan.inputs))
  const records = []
  for (const entry of plan.inputs) {
    assert(/^[a-f0-9]{64}$/.test(entry.sha256), 'Each retained artifact requires a byte digest')
    const bytes = read(entry.file)
    assert.equal(sha256(bytes), entry.sha256, 'Retained artifact bytes changed')
    records.push(...decodeInputs(bytes, entry).map((input) => inputRecord(input, entry)))
  }
  const groups = GROUPS.map((name) => ({
    name,
    sourceSha256: Array.from(
      new Set(
        records.filter((record) => record.group === name).map((record) => record.sourceSha256),
      ),
    ).sort(),
  }))
  return {
    inventory: { status: 'HISTORICAL-RECOVERY-NOT-REGISTRATION', complete: false, groups },
    records,
  }
}

function main() {
  const [planFile, output] = process.argv.slice(2)
  assert(
    planFile && output,
    'Usage: node retained-input-hashes.mjs <plan.json> <absent-output-directory>',
  )
  const planBytes = readFileSync(planFile)
  const plan = JSON.parse(planBytes)
  for (const entry of plan.inputs) {
    const actual = realpathSync(entry.file)
    assert(
      !/oasst|held.?out|evalbatch|\/test\/evaluation\//i.test(actual),
      'Held-out content is outside recovery scope',
    )
  }
  const { inventory, records } = recoverInputs(plan)
  mkdirSync(output)
  writeFileSync(path.join(output, 'grouped-hashes.json'), encode(inventory))
  writeFileSync(
    path.join(output, 'provenance.jsonl.gz'),
    gzipSync(records.map((record) => JSON.stringify(record)).join('\n') + '\n'),
  )
  writeFileSync(
    path.join(output, 'summary.json'),
    encode({
      planSha256: sha256(planBytes),
      files: plan.inputs.length,
      records: records.length,
      groups: inventory.groups.map((group) => ({
        name: group.name,
        unique: group.sourceSha256.length,
      })),
    }),
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
