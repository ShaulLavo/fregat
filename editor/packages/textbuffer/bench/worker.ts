import type { PieceTableAnchor, PieceTableSnapshot } from '@singapore-editor/textbuffer'
import { parseFixture } from './contracts.ts'
import type { Buffer, Edit, Factory, Fixture } from './contracts.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { applyOperation, loadAdapter } from './adapters.ts'
import { indexLines, oracleQuery } from './fixtures.ts'
import { consume, sha256 } from './support.ts'

function collect() {
  if (!globalThis.gc) throw new Error('Worker requires node --expose-gc')
  globalThis.gc()
  globalThis.gc()
  return process.memoryUsage()
}

function createAnchors(buffer: Buffer, fixture: Fixture) {
  if (fixture.mode === 'anchors')
    return fixture.anchorOffsets.map((offset, index) =>
      buffer.anchor!(offset, index % 2 ? 'right' : 'left'),
    )
  if (fixture.mode === 'anchor-density')
    return fixture.anchors.map((anchor) => buffer.anchor!(anchor.offset, anchor.bias))
  return []
}

function resolveAll(buffer: Buffer, anchors: PieceTableAnchor[], checksum: number) {
  for (const anchor of anchors) {
    const resolved = buffer.resolve!(anchor)
    checksum = consume(resolved.offset, consume(resolved.liveness === 'live' ? 1 : 0, checksum))
  }
  return checksum
}

export function prepareState(factory: Factory, fixture: Fixture) {
  const buffer = factory.create(fixture.initial)
  const anchors = createAnchors(buffer, fixture)
  for (const operation of fixture.setup) applyOperation(buffer, operation)
  const root = fixture.mode === 'branches' ? buffer.retain!() : null
  return { buffer, anchors, root }
}

function editBranch(factory: Factory, root: PieceTableSnapshot, edit: Edit, checksum: number) {
  const branch = factory.restore!(root)
  applyOperation(branch, edit)
  const inserted = branch.range(edit.from, edit.from + edit.text.length)
  return consume(inserted, consume(branch.length(), checksum))
}

export function execute(factory: Factory, fixture: Fixture) {
  const before = collect()
  const context = fixture.mode === 'load' ? null : prepareState(factory, fixture)
  // Setup is not edit/read latency. Discard its temporary garbage before timing.
  if (context) collect()
  const started = performance.now()
  const workload = runOperations(factory, fixture, context)
  const elapsedMs = performance.now() - started
  // Memory is captured before full-text checks or invariant inspection allocate anything.
  const after = collect()
  const retainedBytes = Object.fromEntries(
    (['heapUsed', 'external', 'arrayBuffers', 'rss'] as const).map((name) => [
      name,
      after[name] - before[name],
    ]),
  )
  return { ...workload, elapsedMs, retainedBytes }
}

export function runOperations(
  factory: Factory,
  fixture: Fixture,
  context: { buffer: Buffer; anchors: PieceTableAnchor[]; root?: PieceTableSnapshot | null } | null,
) {
  const buffer = fixture.mode === 'load' ? factory.create(fixture.initial) : context!.buffer
  const retained: PieceTableSnapshot[] = []
  const retainAt = new Set(
    ('retained' in fixture ? (fixture.retained ?? []) : []).map((item) => item.before),
  )
  let checksum = 2166136261
  if (fixture.mode !== 'load')
    for (let index = 0; index < fixture.operations.length; index += 1) {
      if (fixture.mode === 'history' && retainAt.has(index)) retained.push(buffer.retain!())
      const operation = fixture.operations[index]
      if (operation.kind === 'anchor') {
        const resolved = buffer.resolve!(context!.anchors[operation.index])
        checksum = consume(resolved.offset, consume(resolved.liveness === 'live' ? 1 : 0, checksum))
      } else if (operation.kind !== 'branch' && fixture.mode === 'anchor-density') {
        applyOperation(buffer, operation)
        checksum = resolveAll(buffer, context!.anchors, checksum)
      } else if (operation.kind === 'branch') {
        checksum = editBranch(factory, context!.root!, operation.edit, checksum)
      } else {
        const value = applyOperation(buffer, operation)
        if (value !== null) checksum = consume(value, checksum)
      }
    }
  return { buffer, retained, anchors: context?.anchors ?? [], checksum }
}

export function validate(
  factory: Factory,
  fixture: Fixture,
  result: ReturnType<typeof runOperations>,
) {
  assert.equal(result.buffer.full(), fixture.expected, `${fixture.name}: final text`)
  const starts = indexLines(fixture.expected)
  assert.equal(result.buffer.length(), fixture.expected.length, 'UTF-16 length')
  assert.equal(result.buffer.lineCount(), starts.length, 'line count')
  assert.deepEqual(result.buffer.issues(), [], 'tree invariants')
  if (fixture.mode === 'branches')
    assert.equal(result.checksum, fixture.expectedDigest, 'branch checksum')
  if (fixture.mode === 'query') {
    assert.equal(result.checksum, fixture.expectedDigest, 'query checksum')
    for (const operation of fixture.operations) {
      assert.deepEqual(
        applyOperation(result.buffer, operation),
        oracleQuery(fixture.expected, starts, operation),
        `${fixture.name}: exact query`,
      )
    }
  }
  if (fixture.mode === 'history') {
    assert.equal(result.retained.length, fixture.retained.length, 'retained snapshot count')
    result.retained.forEach((snapshot, index) =>
      assert.equal(
        sha256(factory.retainedText!(snapshot)),
        fixture.retained[index].sha256,
        `retained version ${index}`,
      ),
    )
    const root = result.retained[0]
    const text = factory.retainedText!(root)
    const branch = factory.restore!(root)
    branch.edit({ from: 0, to: 0, text: 'branch:' })
    assert.equal(branch.full(), 'branch:' + text)
    assert.equal(
      factory.retainedText!(root),
      text,
      'restoring a branch must not mutate its ancestor',
    )
  }
  if (fixture.mode === 'anchor-density') {
    // The digest covers every resolution after every edit against the string model.
    assert.equal(result.checksum, fixture.expectedDigest, 'anchor density checksum')
    result.anchors.forEach((anchor, index) => {
      const expected = { offset: fixture.expectedOffsets[index], liveness: 'live' }
      assert.deepEqual(result.buffer.resolve!(anchor), expected, `anchor ${index}`)
      assert.deepEqual(result.buffer.resolveLinear!(anchor), expected, `linear anchor ${index}`)
    })
  }
  if (fixture.mode === 'anchors') {
    // This is the library's independent linear traversal, not a second editor's semantics.
    const references = result.anchors.map((anchor) => result.buffer.resolveLinear!(anchor))
    let expected = 2166136261
    for (const operation of fixture.operations) {
      const reference = references[operation.index]
      assert.deepEqual(result.buffer.resolve!(result.anchors[operation.index]), reference)
      expected = consume(reference.offset, consume(reference.liveness === 'live' ? 1 : 0, expected))
    }
    assert.equal(result.checksum, expected, 'anchor checksum')
  }
}

async function main() {
  const [engine, filename, expectedHash, warmupsText, retention = 'always'] = process.argv.slice(2)
  const bytes = readFileSync(filename)
  assert.equal(sha256(bytes), expectedHash, 'fixture identity')
  const fixture = parseFixture(JSON.parse(bytes.toString('utf8')))
  if (fixture.category === 'singapore-only')
    assert.equal(engine, 'singapore', 'unsupported semantics')
  const factory = await loadAdapter(engine, {}, retention)
  const warmups = Number(warmupsText)
  assert(Number.isSafeInteger(warmups) && warmups >= 0 && warmups <= 20)
  for (let index = 0; index < warmups; index += 1) {
    const warm = execute(factory, fixture)
    validate(factory, fixture, warm)
  }
  const result = execute(factory, fixture)
  validate(factory, fixture, result)
  process.stdout.write(
    JSON.stringify({
      engine,
      retention: factory.retention ?? null,
      fixtureSha256: expectedHash,
      elapsedMs: result.elapsedMs,
      checksum: result.checksum,
      retainedBytes: result.retainedBytes,
      structure: result.buffer.stats(),
      retainedVersions: result.retained.length,
      correctness: 'passed',
    }) + '\n',
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main()
