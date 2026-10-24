import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { parseTestCounts, qualificationMode, qualificationTestPlan } from './qualify'
import { inspectCandidate, promotionVerdict } from './report'

const execute = promisify(execFile)

test('missing candidate and evaluation evidence cannot certify cutover from a passing baseline', () => {
  const report = promotionVerdict(
    [{ suite: 'completed', fixture: 'control', status: 'passed', findings: [] }],
    true,
  )
  expect(report.verdict).toBe('NOT VERIFIED')
  expect(report.reasons).toContain('Trusted candidate promotion receipts have not been supplied.')
})

test('an unmet baseline expectation stays failed in the readiness report', () => {
  const report = promotionVerdict(
    [{ suite: 'streaming', fixture: 'control', status: 'failed', findings: ['missing strong'] }],
    false,
  )
  expect(report.counts.failed).toBe(1)
  expect(report.verdict).toBe('NOT VERIFIED')
})

test('malformed and missing test counters fail rather than inventing executed coverage', () => {
  expect(
    parseTestCounts({
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
    }),
  ).toEqual({
    numTotalTests: 2,
    numPassedTests: 1,
    numFailedTests: 1,
    numPendingTests: 0,
    numTodoTests: 0,
  })
  expect(() => parseTestCounts({})).toThrow()
  expect(() =>
    parseTestCounts({
      numTotalTests: -1,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
    }),
  ).toThrow()
  expect(() =>
    parseTestCounts({
      numTotalTests: 1,
      numPassedTests: '1',
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
    }),
  ).toThrow()
  expect(() =>
    parseTestCounts({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
    }),
  ).toThrow()
  expect(
    parseTestCounts({
      numTotalTests: 10,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 9,
      numTodoTests: 1,
    }),
  ).toEqual({
    numTotalTests: 10,
    numPassedTests: 0,
    numFailedTests: 0,
    numPendingTests: 9,
    numTodoTests: 1,
  })
})

test('actual native semantics and adapter probes report availability without certification', async () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const candidate = await inspectCandidate(root)
  expect(candidate.status, candidate.semanticChecks.findings.join('\n')).toBe(
    'available-unqualified',
  )
  expect(candidate.profile).toBe('gfm-extended')
  expect(candidate.semanticChecks).toEqual({ executed: 8, passed: 8, failed: 0, findings: [] })
  expect(candidate.observedCapabilities).toEqual({
    commonmark: true,
    gfm: true,
    math: true,
    footnotes: true,
    cjkFlanking: true,
  })
  expect(candidate.artifacts.map((artifact) => artifact.kind)).toEqual([
    'grammar',
    'chatGrammar',
    'resolver',
    'binding',
    'semantic-binding',
    'runtime',
  ])
  const require = createRequire(path.join(root, 'packages/markdown/package.json'))
  const binding = require.resolve('tree-sitter-md')
  expect(candidate.artifacts.map((artifact) => path.resolve(root, artifact.file))).toEqual([
    require.resolve('tree-sitter-md/tree-sitter-markdown.wasm'),
    require.resolve('tree-sitter-md/tree-sitter-markdown-math.wasm'),
    require.resolve('tree-sitter-md/tree-sitter-md.wasm'),
    binding,
    path.join(path.dirname(binding), 'semantic.js'),
    require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
  ])
  for (const artifact of candidate.artifacts)
    expect(artifact.sha256).toBe(
      createHash('sha256')
        .update(await readFile(path.resolve(root, artifact.file)))
        .digest('hex'),
    )
  expect(candidate.missing).toContain('complete promotion receipts')
})

test.each(['grammar', 'chatGrammar', 'resolver'] as const)(
  'hashes and exercises supplied valid %s bytes independently',
  async (kind) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'markdown-inspection-'))
    try {
      const root = path.resolve(import.meta.dirname, '../..')
      const require = createRequire(path.join(root, 'packages/markdown/package.json'))
      const before = await inspectCandidate(root)
      expect(before.status).toBe('available-unqualified')
      const original = await readFile(
        require.resolve(
          `tree-sitter-md/${{ grammar: 'tree-sitter-markdown.wasm', chatGrammar: 'tree-sitter-markdown-math.wasm', resolver: 'tree-sitter-md.wasm' }[kind]}`,
        ),
      )
      const bytes = Buffer.concat([original, Buffer.from([0, 2, 1, 120])])
      const file = path.join(directory, `${kind}.wasm`)
      await writeFile(file, bytes)
      const after = await inspectCandidate(root, { [kind]: file })
      expect(after.status).toBe('available-unqualified')
      expect(after.semanticChecks).toEqual({ executed: 8, passed: 8, failed: 0, findings: [] })
      expect(after.observedCapabilities).toEqual(before.observedCapabilities)
      expect(after.artifacts.find((artifact) => artifact.kind === kind)).toEqual({
        kind,
        file: path.relative(root, file),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
      expect(after.artifacts.find((artifact) => artifact.kind === kind)?.sha256).not.toBe(
        before.artifacts.find((artifact) => artifact.kind === kind)?.sha256,
      )
      expect(after.artifacts.filter((artifact) => artifact.kind !== kind)).toEqual(
        before.artifacts.filter((artifact) => artifact.kind !== kind),
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test.each(['cold', 'inspection-warm', 'native-warm'])(
  'Math-named non-language bytes fail semantic loading with %s native state',
  async (mode) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'markdown-inspection-'))
    try {
      const root = path.resolve(import.meta.dirname, '../..')
      const require = createRequire(path.join(root, 'packages/markdown/package.json'))
      const name = Array.from(new TextEncoder().encode('tree_sitter_markdown_math'))
      const bytes = new Uint8Array(
        [
          0,
          97,
          115,
          109,
          1,
          0,
          0,
          0,
          1,
          5,
          1,
          96,
          0,
          1,
          127,
          3,
          2,
          1,
          0,
          7,
          name.length + 4,
          1,
          name.length,
        ].concat(name, [0, 0, 10, 6, 1, 4, 0, 65, 0, 11]),
      )
      const chatGrammar = path.join(directory, 'chat.wasm')
      await writeFile(chatGrammar, bytes)
      const { stdout } = await execute(
        process.execPath,
        [
          '--eval',
          `
        import assert from 'node:assert/strict'
        const root = ${JSON.stringify(root)}
        const mode = ${JSON.stringify(mode)}
        if (mode === 'native-warm') {
          const native = await import(${JSON.stringify(pathToFileURL(require.resolve('tree-sitter-md')).href)})
          await native.init()
          assert(native.memoryBytes() > 0)
        }
        const { inspectCandidate } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/markdown/report.ts')).href)})
        if (mode === 'inspection-warm') {
          assert.equal((await inspectCandidate(root)).status, 'available-unqualified')
        }
        const candidate = await inspectCandidate(root, { chatGrammar: ${JSON.stringify(chatGrammar)} })
        console.log(JSON.stringify(candidate))
        assert.equal(candidate.status, 'unavailable', 'Math bytes must be loaded even after native initialization')
        assert.equal(candidate.semanticChecks.executed, 0)
        assert.deepEqual(candidate.observedCapabilities, {})
        assert.deepEqual(candidate.semanticChecks.findings, ['Language module has no dylink.0 section'])
        assert.equal(candidate.artifacts.find(artifact => artifact.kind === 'chatGrammar').sha256, ${JSON.stringify(createHash('sha256').update(bytes).digest('hex'))})
      `,
        ],
        { timeout: 30_000 },
      )
      expect(stdout).toContain('"status":"unavailable"')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  40_000,
)

test('a loadable alternate math grammar cannot inherit observed math support', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-inspection-'))
  try {
    const root = path.resolve(import.meta.dirname, '../..')
    const require = createRequire(path.join(root, 'packages/markdown/package.json'))
    const before = await inspectCandidate(root)
    expect(before.observedCapabilities.math).toBe(true)
    const bytes = await readFile(require.resolve('tree-sitter-md/tree-sitter-markdown-math.wasm'))
    let offset = bytes.indexOf('math_flow')
    expect(offset).toBeGreaterThan(0)
    while (offset !== -1) {
      bytes.set(Buffer.from('xxxx_flow'), offset)
      offset = bytes.indexOf('math_flow', offset + 9)
    }
    const chatGrammar = path.join(directory, 'alternate-chat.wasm')
    await writeFile(chatGrammar, bytes)
    const after = await inspectCandidate(root, { chatGrammar })
    expect(after.status).toBe('available-unqualified')
    expect(after.semanticChecks.executed).toBe(8)
    expect(after.semanticChecks.findings).toContain('Candidate probe does not satisfy math.')
    expect(after.observedCapabilities.math).toBe(false)
    expect(after.artifacts.find((artifact) => artifact.kind === 'chatGrammar')?.sha256).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('unchanged valid inspections keep exercising all semantic probes', async () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const first = await inspectCandidate(root)
  const second = await inspectCandidate(root)
  expect(first.status).toBe('available-unqualified')
  expect(second.status).toBe('available-unqualified')
  expect(second.artifacts).toEqual(first.artifacts)
  expect(second.semanticChecks).toEqual({ executed: 8, passed: 8, failed: 0, findings: [] })
  expect(second.observedCapabilities).toEqual(first.observedCapabilities)
})

test('missing and invalid actual artifacts cannot be reported as available', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-inspection-'))
  try {
    const root = path.resolve(import.meta.dirname, '../..')
    const missing = await inspectCandidate(root, { grammar: path.join(directory, 'missing.wasm') })
    expect(missing.status).toBe('unavailable')
    await writeFile(path.join(directory, 'invalid.wasm'), 'invalid artifact')
    const invalid = await inspectCandidate(root, { resolver: path.join(directory, 'invalid.wasm') })
    expect(invalid.status).toBe('unavailable')
    expect(invalid.semanticChecks.executed).toBe(0)
    await writeFile(
      path.join(directory, 'empty.wasm'),
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    )
    const empty = await inspectCandidate(root, { grammar: path.join(directory, 'empty.wasm') })
    expect(empty.status).toBe('unavailable')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test.each(['grammar', 'chatGrammar', 'resolver'] as const)(
  'rejects missing, invalid and export-empty %s bytes after singleton initialization',
  async (kind) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'markdown-inspection-'))
    try {
      const root = path.resolve(import.meta.dirname, '../..')
      expect((await inspectCandidate(root)).status).toBe('available-unqualified')
      const file = path.join(directory, `${kind}.wasm`)
      expect((await inspectCandidate(root, { [kind]: file })).status).toBe('unavailable')
      await writeFile(file, 'invalid artifact')
      const invalid = await inspectCandidate(root, { [kind]: file })
      expect(invalid.status).toBe('unavailable')
      expect(invalid.semanticChecks.executed).toBe(0)
      await writeFile(file, new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
      const empty = await inspectCandidate(root, { [kind]: file })
      expect(empty.status).toBe('unavailable')
      expect(empty.semanticChecks.executed).toBe(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test.each([
  { kind: 'chatGrammar', file: 'tree-sitter-markdown.wasm' },
  { kind: 'chatGrammar', file: 'tree-sitter-md.wasm' },
  { kind: 'grammar', file: 'tree-sitter-markdown-math.wasm' },
] as const)(
  'rejects $file supplied as $kind after singleton initialization',
  async ({ kind, file }) => {
    const root = path.resolve(import.meta.dirname, '../..')
    const require = createRequire(path.join(root, 'packages/markdown/package.json'))
    expect((await inspectCandidate(root)).status).toBe('available-unqualified')
    const candidate = await inspectCandidate(root, {
      [kind]: require.resolve(`tree-sitter-md/${file}`),
    })
    expect(candidate.status).toBe('unavailable')
    expect(candidate.semanticChecks.executed).toBe(0)
    expect(candidate.semanticChecks.findings).toContain(
      'Candidate artifact lacks required parser exports.',
    )
  },
)

test('qualification modes select actual candidate configurations and preserve baseline comparisons', () => {
  expect(qualificationMode({})).toBe('paired')
  expect(qualificationMode({ baseline: true })).toBe('baseline')
  expect(qualificationMode({ candidate: true })).toBe('candidate')
  expect(() => qualificationMode({ baseline: true, candidate: true })).toThrow()
  const candidate = qualificationTestPlan('parity', 'candidate')
  expect(candidate).toHaveLength(2)
  expect(candidate[0].flags).toContain('qualification-candidate')
  const baseline = qualificationTestPlan('parity', 'baseline')
  expect(baseline[0].flags).toContain('**/qualification-candidate.test.ts')
  const visual = qualificationTestPlan('visual', 'candidate')
  expect(visual).toHaveLength(2)
  expect(visual.map((plan) => plan.flags)).toEqual(
    expect.arrayContaining([
      expect.arrayContaining(['--mode', 'candidate']),
      expect.arrayContaining(['--mode', 'baseline']),
    ]),
  )
})
