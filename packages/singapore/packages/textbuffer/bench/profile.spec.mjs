import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { loadAdapter } from './adapters.mjs'
import { makeFixtures } from './fixtures.mjs'
import { instrument, prepareProbes } from './probes.mjs'
import { createCounters, summarizeCpu, summarizeHeap, gcWithin } from './profile-support.mjs'
import { profileOptions } from './profile.mjs'
import { execute, validate } from './worker.mjs'
import { benchRoot, packageRoot, fileHashes, sha256 } from './support.mjs'

const frame = (functionName, url = 'file:///bench/worker.mjs') => ({
  functionName,
  url,
  lineNumber: 0,
  columnNumber: 0,
})

test('counters ignore setup and validation, reset between windows', () => {
  const counter = createCounters()
  counter.add('setup', 100)
  counter.start()
  counter.add('work', 2)
  assert.deepEqual(counter.stop(), { work: 2 })
  counter.add('validation', 100)
  assert.deepEqual(counter.stop(), { work: 2 })
  counter.start()
  assert.deepEqual(counter.stop(), {})
})

test('AST probes preserve arrow returns, class this, recursion and loops', () => {
  const source = `
    const record = (n) => ({ n });
    function factorial(n) { if (n < 2) return 1; return n * factorial(n - 1); }
    class Reader { constructor(n) { this.n = n; } read() { let sum = 0; for (let i = 0; i < this.n; i++) sum += i; return record(sum); } }
    globalThis.result = [factorial(4), new Reader(4).read().n];
  `
  const transformed = instrument(source, 'test.js')
  const counter = createCounters()
  const context = { __textbufferBenchCounters: counter }
  counter.start()
  vm.runInNewContext(transformed.text, context)
  assert.deepEqual(Array.from(context.result), [24, 6])
  const counts = counter.stop()
  assert.equal(counts['test.factorial.calls'], 4)
  assert.equal(counts['test.Reader.read.loopIterations'], 4)
  assert.equal(counts['test.record.calls'], 1)
  assert.throws(() => instrument(transformed.text, 'test.js'), /twice/)
})

test('CPU self buckets conserve samples; recursion is not double-counted inclusively', () => {
  const tree = frame('walk', 'file:///textbuffer/dist/tree.js')
  const profile = {
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2, 5] },
      { id: 2, callFrame: frame('runOperations'), children: [3] },
      { id: 3, callFrame: tree, children: [4] },
      { id: 4, callFrame: tree, children: [] },
      { id: 5, callFrame: frame('validate'), children: [] },
    ],
    samples: [4, 3, 4, 5],
  }
  const result = summarizeCpu([profile])
  assert.equal(result.samples, 3)
  assert.equal(result.ignoredSamples, 1)
  assert.equal(
    result.self.reduce((sum, item) => sum + item.value, 0),
    3,
  )
  assert.equal(result.inclusive.find((item) => item.name.endsWith(':walk')).value, 3)
  assert.equal(
    result.categories.reduce((sum, item) => sum + item.value, 0),
    3,
  )
  assert(result.warning)
})

test('allocation summary excludes inspector/setup stacks and labels inclusive overlap', () => {
  const result = summarizeHeap([
    {
      head: {
        callFrame: frame('(root)'),
        selfSize: 10,
        children: [
          {
            callFrame: frame('runOperations'),
            selfSize: 20,
            children: [
              {
                callFrame: frame('clone', 'file:///textbuffer/dist/reverseIndex.js'),
                selfSize: 30,
                children: [],
              },
            ],
          },
          { callFrame: frame('prepareState'), selfSize: 100, children: [] },
        ],
      },
    },
  ])
  assert.equal(result.sampledBytes, 50)
  assert.equal(result.ignoredBytes, 110)
  assert.equal(
    result.categories.reduce((sum, item) => sum + item.value, 0),
    50,
  )
})

test('GC interval excludes forced setup and validation collections', () => {
  const entries = [0, 9, 12, 19, 30].map((startTime) => ({
    startTime,
    duration: 2,
    detail: { kind: 1, flags: 0 },
  }))
  const result = gcWithin(entries, 10, 20)
  assert.deepEqual(
    result.map((item) => item.durationMs),
    [1, 2, 1],
  )
  assert.equal(result.length, 3)
})

test('profile options fail closed instead of silently dropping modes', () => {
  assert.deepEqual(profileOptions(['--modes', 'counters,gc']).modes, ['counters', 'gc'])
  for (const args of [
    ['--modes', 'cpu,cpu'],
    ['--modes', 'oops'],
    ['--repeats', '0'],
    ['--seed', '-1'],
    ['--typo', 'cpu'],
    ['--only'],
  ])
    assert.throws(() => profileOptions(args))
})

test('every smoke workload agrees in clean and disposable instrumented builds', async () => {
  const baseline = {
    source: fileHashes(path.join(packageRoot, 'src')),
    dist: fileHashes(path.join(packageRoot, 'dist')),
  }
  const temporary = mkdtempSync(path.join(benchRoot, '.cache', 'probe-test-'))
  try {
    const probes = prepareProbes(temporary)
    const counter = createCounters()
    globalThis.__textbufferBenchCounters = counter
    for (const engine of ['singapore', 'vscode']) {
      const clean = await loadAdapter(engine)
      const instrumented = await loadAdapter(engine, probes.roots)
      for (const fixture of makeFixtures('smoke')) {
        if (fixture.category === 'singapore-only' && engine !== 'singapore') continue
        const expected = execute(clean, fixture)
        validate(clean, fixture, expected)
        // The production diagnostic worker gates only runOperations, unlike this equivalence test.
        counter.start()
        const actual = execute(instrumented, fixture)
        const counts = counter.stop()
        validate(instrumented, fixture, actual)
        assert.deepEqual(counter.stop(), counts, 'validation changed counters')
        assert.equal(actual.checksum, expected.checksum, engine + ': ' + fixture.name)
        assert.equal(actual.buffer.full(), expected.buffer.full())
        assert(Object.keys(counts).length > 0)
      }
    }
    assert.deepEqual(
      {
        source: fileHashes(path.join(packageRoot, 'src')),
        dist: fileHashes(path.join(packageRoot, 'dist')),
      },
      baseline,
    )
  } finally {
    delete globalThis.__textbufferBenchCounters
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('real CPU/heap/GC/counter worker windows validate and produce raw traces', () => {
  const temporary = mkdtempSync(path.join(benchRoot, '.cache', 'profile-test-'))
  try {
    const probes = prepareProbes(temporary)
    const roots = path.join(temporary, 'roots.json')
    writeFileSync(roots, JSON.stringify(probes.roots))
    const fixture = makeFixtures('smoke').find((item) => item.name === 'random-insertions')
    const bytes = JSON.stringify(fixture)
    const filename = path.join(temporary, 'fixture.json')
    writeFileSync(filename, bytes)
    for (const mode of ['cpu', 'heap', 'gc', 'counters']) {
      const output = path.join(temporary, mode)
      mkdirSync(output)
      const report = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--expose-gc',
            path.join(benchRoot, 'profile-worker.mjs'),
            'singapore',
            filename,
            sha256(bytes),
            mode,
            '1',
            output,
            roots,
            '0',
          ],
          { encoding: 'utf8' },
        ),
      )
      assert.equal(report.epochs[0].correctness, 'passed')
      assert.equal(report.diagnosticOnly, true)
      assert.deepEqual(JSON.parse(readFileSync(path.join(output, 'summary.json'))), report)
      if (mode === 'cpu')
        assert(JSON.parse(readFileSync(path.join(output, '0.cpuprofile'))).nodes.length > 0)
      if (mode === 'heap') assert(JSON.parse(readFileSync(path.join(output, '0.heapprofile'))).head)
      if (mode !== 'counters') assert.deepEqual(report.epochs[0].counters, {})
      else {
        assert.equal(
          report.epochs[0].counters['buffers.createInitialBuffers.calls'],
          undefined,
          'setup leaked into counters',
        )
        assert.equal(
          report.epochs[0].counters['edits.insertIntoPieceTable.calls'],
          fixture.operations.length,
        )
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
