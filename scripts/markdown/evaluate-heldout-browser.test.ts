import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { absent } from './production-cleanup'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import {
  browserInput,
  parseBrowserReceipt,
  validateBrowserEvaluation,
  type CandidateIdentity,
  type EvaluationBatch,
  type EvaluationMessage,
} from './evaluate-heldout'
import {
  collectBrowserEvaluation,
  productionBuildSha256,
  validateBrowserInputShape,
  validateBuildArtifacts,
  validateServedFiles,
  withBrowserLifetime,
  observePageErrors,
  executeBrowserInput,
} from './evaluate-heldout-browser'

const temporary = new Set<string>()
afterEach(async () => {
  await Promise.all(
    Array.from(temporary, (directory) => rm(directory, { recursive: true, force: true })),
  )
  temporary.clear()
})

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const candidate: CandidateIdentity = {
  candidateCommit: 'a'.repeat(40),
  candidateSourceSha256: hash('candidate-source'),
  artifacts: {
    grammarSha256: hash('grammar'),
    chatGrammarSha256: hash('chat grammar'),
    resolverSha256: hash('resolver'),
    runtimeWasmSha256: hash('runtime-wasm'),
    runtimeBindingSha256: hash('runtime-binding'),
    parserBindingSha256: hash('parser-binding'),
    parserSemanticsSha256: hash('parser-semantics'),
    parserConstantsSha256: hash('parser-constants'),
    lockfileSha256: hash('lockfile'),
  },
}

function message(index: number): EvaluationMessage {
  const source = `Owned browser control ${index}. **stable**\n`
  return {
    id: `owned-browser-${index}`,
    source,
    sha256: hash(source),
    createdDate: '2023-04-01',
    provenance: {
      dataset: 'owned-browser-controls',
      revision: 'b'.repeat(40),
      license: 'MIT',
      url: 'https://example.test/owned-browser-controls',
    },
    split: 'evaluation',
  }
}

function batch(messages: readonly EvaluationMessage[]): EvaluationBatch {
  return {
    file: 'oasst1-batch-998.json.gz',
    messages: 100,
    sourceSha256: messages.map((entry) => entry.sha256),
    assetSha256: hash('owned-browser-compressed-control'),
    uncompressedSha256: hash('owned-browser-payload'),
    status: 'sealed',
  }
}

function observation(text: string) {
  return {
    text,
    elements: [{ tag: 'p', text, attributes: {}, parents: [] }],
  }
}

function frame(source: string, live: boolean, text = source) {
  return { ...observation(text), inputSha256: hash(source), inputUtf16Units: source.length, live }
}

function syntheticProbe() {
  return {
    show: async (_engine: string, source: string) => frame(source, false),
    run: async (_engine: string, source: string, chunks: readonly string[]) => {
      const frames = chunks.map((text) => frame(text, true)).concat([frame(source, false)])
      return { frames, final: frames.at(-1) }
    },
  }
}

function syntheticInput() {
  const messages = Array.from({ length: 100 }, (_, index) => message(index))
  const selected = batch(messages)
  const input = browserInput(messages, candidate, selected)
  return {
    ...input,
    messages: input.messages.map((entry) => ({
      ...entry,
      schedules: [
        {
          id: 'synthetic-schedule',
          profile: 'unicode' as const,
          offsets: [0, entry.source.length],
        },
      ],
    })),
  }
}

test('collects both engines, preserves source chunks, and includes stream settlement', async () => {
  const input = syntheticInput()
  const calls: { operation: string; engine: string; source: string; chunks: readonly string[] }[] =
    []
  const result = await collectBrowserEvaluation(
    input,
    { inputSha256: hash('browser-input'), productionBuildSha256: hash('production-build') },
    {
      show: async (engine, source) => {
        calls.push({ operation: 'show', engine, source, chunks: [] })
        return frame(source, false)
      },
      run: async (engine, source, chunks) => {
        calls.push({ operation: 'run', engine, source, chunks })
        const texts = chunks.concat([source])
        const frames = texts.map((text, index) => frame(text, index < chunks.length))
        return { frames, final: frames.at(-1) }
      },
    },
  )
  expect(result.rawEvidence.status).toBe('passed')
  expect(result.rawEvidence.failures).toEqual([])
  expect(result.receipt?.rows).toHaveLength(100)
  expect(result.receipt?.rows[0]?.completed).toHaveLength(1)
  expect(result.receipt?.rows[0]?.streams[0]?.observations).toHaveLength(3)
  expect(calls).toHaveLength(400)
  expect(calls[0]?.operation).toBe('show')
  expect(calls[0]?.source).toBe(input.messages[0]?.source)
  expect(calls[2]?.operation).toBe('run')
  expect(calls[2]?.chunks).toEqual(['', input.messages[0]?.source])
})

test('retains actual probe exceptions as failed raw evidence without claiming a receipt', async () => {
  const input = syntheticInput()
  const result = await collectBrowserEvaluation(
    input,
    { inputSha256: hash('browser-input'), productionBuildSha256: hash('production-build') },
    {
      show: async (engine, source) => {
        if (engine === 'tree-sitter') throw new TypeError('synthetic tree-sitter failure')
        return frame(source, false)
      },
      run: async (engine) => {
        if (engine === 'tree-sitter') throw new TypeError('synthetic tree-sitter failure')
        const frame = observation('owned')
        return { frames: [frame, frame], final: frame }
      },
    },
  )
  expect(result.receipt).toBeNull()
  expect(result.rawEvidence.status).toBe('failed')
  expect(result.rawEvidence.failures.join('\n')).toContain('synthetic tree-sitter failure')
  expect(result.rawEvidence.records).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'failure', engine: 'tree-sitter' })]),
  )
})

test('rejects changed authored source hashes before browser execution', () => {
  const input = syntheticInput()
  const changed = {
    ...input,
    messages: input.messages.map((entry, index) =>
      index === 7 ? { ...entry, source: `${entry.source}changed` } : entry,
    ),
  }
  expect(() => validateBrowserInputShape(changed)).toThrow()
})

test('production build digest is stable by path and changes when an artifact changes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-browser-build-'))
  temporary.add(directory)
  await mkdir(path.join(directory, 'assets'), { recursive: true })
  await writeFile(path.join(directory, 'index.html'), 'index')
  await writeFile(path.join(directory, 'assets', 'probe.js'), 'probe')
  const first = await productionBuildSha256(directory)
  const second = await productionBuildSha256(directory)
  expect(second).toBe(first)
  await writeFile(path.join(directory, 'assets', 'probe.js'), 'changed')
  expect(await productionBuildSha256(directory)).not.toBe(first)
})

test('rejects a retained stream whose settlement differs from the fresh completed output', async () => {
  const input = syntheticInput()
  const result = await collectBrowserEvaluation(
    input,
    { inputSha256: hash('browser-input'), productionBuildSha256: hash('production-build') },
    {
      show: async (_engine, source) => {
        return frame(source, false)
      },
      run: async (_engine, source, chunks) => {
        const frames = chunks.map((text) => frame(text, true))
        const settlement = frame(source, false, `${source} retained mismatch`)
        return { frames: frames.concat([settlement]), final: settlement }
      },
    },
  )
  expect(result.receipt).toBeNull()
  expect(result.rawEvidence.status).toBe('failed')
  expect(result.rawEvidence.failures.join('\n')).toContain(
    'stream settlement differs from its fresh completed output',
  )
})

test('rejects identical constant observations that ignore every requested source', async () => {
  const result = await collectBrowserEvaluation(
    syntheticInput(),
    { inputSha256: hash('input'), productionBuildSha256: hash('build') },
    {
      show: async () => observation('constant'),
      run: async () => {
        const frame = observation('constant')
        return { frames: [frame, frame, frame], final: frame }
      },
    },
  )
  expect(result.receipt).toBeNull()
  expect(result.rawEvidence.status).toBe('failed')
})

test.each(['completed', 'prefix', 'settlement'] as const)(
  'rejects incorrect %s provenance even when both engines agree',
  async (phase) => {
    const input = syntheticInput()
    const good = syntheticProbe()
    const result = await collectBrowserEvaluation(
      input,
      { inputSha256: hash('input'), productionBuildSha256: hash('build') },
      {
        show: async (engine, source) =>
          phase === 'completed' ? frame('constant', false) : good.show(engine, source),
        run: async (engine, source, chunks) => {
          const receipt = await good.run(engine, source, chunks)
          const index = phase === 'prefix' ? 0 : receipt.frames.length - 1
          const frames = receipt.frames.map((value, position) =>
            phase !== 'completed' && position === index
              ? frame('constant', phase === 'prefix')
              : value,
          )
          return { frames, final: frames.at(-1) }
        },
      },
    )
    expect(result.receipt).toBeNull()
    expect(result.rawEvidence.failures.join(' ')).toContain('provenance')
  },
)

test.each(['inputSha256', 'inputUtf16Units', 'live'] as const)(
  'attachment rechecks altered %s across completed, exact prefixes and settlement',
  async (field) => {
    const input = syntheticInput()
    const result = await collectBrowserEvaluation(
      input,
      { inputSha256: hash('input'), productionBuildSha256: hash('build') },
      syntheticProbe(),
    )
    expect(result.receipt).not.toBeNull()
    for (const phase of ['completed', 'prefix', 'settlement']) {
      const changed = JSON.parse(JSON.stringify(result.receipt))
      const row = changed.rows[0]
      const pair =
        phase === 'completed'
          ? row.completed[0]
          : row.streams[0].observations[phase === 'prefix' ? 0 : 2]
      const value =
        field === 'live'
          ? !pair.baseline.live
          : field === 'inputSha256'
            ? hash('altered')
            : pair.baseline.inputUtf16Units + 1
      pair.baseline[field] = value
      pair.candidate[field] = value
      const receipt = parseBrowserReceipt(changed)
      expect(validateBrowserEvaluation(input, receipt).failures.join(' ')).toContain('provenance')
    }
  },
)

function browserBuildArtifacts(suffix = '') {
  return [
    { file: `tree-sitter-markdown${suffix}.wasm`, sha256: candidate.artifacts.grammarSha256 },
    {
      file: `tree-sitter-markdown-chat${suffix}.wasm`,
      sha256: candidate.artifacts.chatGrammarSha256,
    },
    { file: `tree-sitter-md${suffix}.wasm`, sha256: candidate.artifacts.resolverSha256 },
  ]
}

function validateCandidateBuild(artifacts: Readonly<ReturnType<typeof browserBuildArtifacts>>) {
  const files = artifacts.map((entry) => ({ ...entry, file: `assets/${entry.file}` }))
  validateBuildArtifacts({ artifacts }, files, candidate.artifacts)
}

test.each(['', '-fixturehash'])(
  'binds both grammar assets and resolver with %s filenames',
  (suffix) => {
    expect(() => validateCandidateBuild(browserBuildArtifacts(suffix))).not.toThrow()
  },
)

test.each([0, 1, 2])(
  'rejects missing required WASM role %s in a self-consistent build',
  (index) => {
    expect(() =>
      validateCandidateBuild(browserBuildArtifacts().filter((_, position) => position !== index)),
    ).toThrow()
  },
)

test.each([0, 1, 2])(
  'rejects changed required WASM role %s with self-consistent build hashes',
  (index) => {
    const artifacts = browserBuildArtifacts().map((entry, position) =>
      position === index ? { ...entry, sha256: hash('changed bytes') } : entry,
    )
    expect(() => validateCandidateBuild(artifacts)).toThrow()
  },
)

test('rejects swapped base and CHAT bytes despite a self-consistent build manifest', () => {
  const artifacts = browserBuildArtifacts()
  const grammar = artifacts[0].sha256
  artifacts[0].sha256 = artifacts[1].sha256
  artifacts[1].sha256 = grammar
  expect(() => validateCandidateBuild(artifacts)).toThrow()
})

test('rejects CHAT bytes under an unrelated role and duplicate grammar assets', () => {
  const artifacts = browserBuildArtifacts()
  expect(() =>
    validateCandidateBuild(
      artifacts.map((entry, index) => (index === 1 ? { ...entry, file: 'unrelated.wasm' } : entry)),
    ),
  ).toThrow()
  expect(() =>
    validateCandidateBuild(
      artifacts.concat([{ ...artifacts[1], file: 'tree-sitter-markdown-chat-duplicate.wasm' }]),
    ),
  ).toThrow()
})

test('checks recorded artifact hashes and rejects swaps before and after navigation', () => {
  const artifacts = browserBuildArtifacts().concat([{ file: 'probe.js', sha256: hash('frozen') }])
  const expected = artifacts.map((entry) => ({ ...entry, file: `assets/${entry.file}` }))
  const build = { artifacts }
  expect(() => validateBuildArtifacts(build, expected, candidate.artifacts)).not.toThrow()
  expect(() =>
    validateBuildArtifacts(
      build,
      expected.map((entry) =>
        entry.file === 'assets/probe.js' ? { ...entry, sha256: hash('swapped') } : entry,
      ),
      candidate.artifacts,
    ),
  ).toThrow()
  expect(() => validateServedFiles(expected, expected)).not.toThrow()
  expect(() =>
    validateServedFiles(expected, [{ file: 'assets/probe.js', sha256: hash('swapped') }]),
  ).toThrow()
  expect(() => validateServedFiles(expected, [])).toThrow()
})

test('served metadata and manifest bytes remain bound to the preflight snapshot', () => {
  const expected = [
    { file: 'markdown-probe-build.json', sha256: hash('metadata') },
    { file: '.vite/manifest.json', sha256: hash('manifest') },
  ]
  for (const index of [0, 1]) {
    const altered = expected.map((entry, position) =>
      position === index ? { ...entry, sha256: hash('altered') } : entry,
    )
    expect(() => validateServedFiles(expected, altered)).toThrow()
  }
})

test.each(['SIGINT', 'SIGTERM'])(
  'handles %s through resource cleanup and verifies actual files are absent',
  async (signal) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'markdown-browser-signal-'))
    temporary.add(directory)
    const signals = new EventEmitter()
    const cleanup = { resources: [], signals: [] }
    let closed = 0
    await expect(
      withBrowserLifetime(
        async (scope) => {
          scope.own({
            name: 'owned-fixture',
            identity: directory,
            close: async () => {
              closed += 1
              await rm(directory, { recursive: true })
            },
            checks: async () => ({ absent: await absent(directory) }),
          })
          signals.emit(signal)
          scope.checkpoint()
        },
        cleanup,
        signals,
      ),
    ).rejects.toThrow('interrupted')
    expect(closed).toBe(1)
    expect(cleanup).toMatchObject({
      signals: [signal],
      resources: [{ checks: { absent: true }, error: null }],
    })
    expect(signals.listenerCount('SIGINT')).toBe(0)
    expect(signals.listenerCount('SIGTERM')).toBe(0)
  },
)

test('captures initialization page errors before a navigation operation starts', () => {
  const page = new EventEmitter()
  const records: {
    engine: 'remark' | 'tree-sitter'
    error: { name: string; message: string; stack: string | null }
  }[] = []
  const errors = observePageErrors(page, 'remark', records)
  const error = new TypeError('synthetic initialization exception')
  page.emit('pageerror', error)
  expect(() => errors.assert()).toThrow(error)
  expect(records[0]?.error.message).toBe(error.message)
  errors.close()
  expect(page.listenerCount('pageerror')).toBe(0)
})

test('preflight errors emit raw failure and cleanup artifacts with null untrusted identities', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-browser-preflight-'))
  temporary.add(directory)
  const input = path.join(directory, 'invalid-input.json')
  await writeFile(input, '{invalid JSON')
  const previous = process.exitCode
  try {
    const result = await executeBrowserInput({
      input,
      build: path.join(directory, 'missing-build'),
      out: path.join(directory, 'receipt.json'),
      port: 43123,
      browser: 'chromium',
      headed: false,
      browserArgs: [],
    })
    expect(result.receipt).toBeNull()
    const raw = JSON.parse(
      await readFile(path.join(directory, 'raw-browser-evidence.json'), 'utf8'),
    )
    expect(raw).toMatchObject({
      status: 'failed',
      inputSha256: null,
      candidate: null,
      batchAssetSha256: null,
      productionBuildSha256: null,
    })
    expect(raw.records[0].error.name).toBe('SyntaxError')
    expect(JSON.parse(await readFile(path.join(directory, 'cleanup.json'), 'utf8'))).toEqual({
      resources: [],
      signals: [],
    })
    await expect(readFile(path.join(directory, 'receipt.json'))).rejects.toThrow()
  } finally {
    process.exitCode = previous
  }
})

test('a resource acquired after interruption still closes before the lifetime returns', async () => {
  const signals = new EventEmitter()
  const cleanup = { resources: [], signals: [] }
  let closed = false
  await expect(
    withBrowserLifetime(
      async (scope) => {
        signals.emit('SIGTERM')
        await Promise.resolve()
        scope.own({
          name: 'late-resource',
          identity: 'synthetic',
          close: async () => {
            closed = true
          },
          checks: async () => ({ closed }),
        })
        scope.checkpoint()
      },
      cleanup,
      signals,
    ),
  ).rejects.toThrow('interrupted')
  expect(cleanup).toMatchObject({ resources: [{ checks: { closed: true }, error: null }] })
})

test('cleanup failure retains the actual exception and still closes remaining resources', async () => {
  const cleanup = { resources: [], signals: [] }
  let closed = false
  await withBrowserLifetime(
    async (scope) => {
      scope.own({
        name: 'first',
        identity: 'synthetic-first',
        close: async () => {
          closed = true
        },
        checks: async () => ({ closed }),
      })
      scope.own({
        name: 'second',
        identity: 'synthetic-second',
        close: async () => {
          throw new TypeError('synthetic close failure')
        },
        checks: async () => ({ closed: false }),
      })
    },
    cleanup,
    new EventEmitter(),
  )
  expect(closed).toBe(true)
  expect(cleanup).toMatchObject({
    resources: [
      { name: 'first', checks: { closed: true }, error: null },
      {
        name: 'second',
        checks: null,
        error: { name: 'TypeError', message: 'synthetic close failure' },
      },
    ],
  })
})

test('attachment rejects changed settlement observations even with intact provenance', async () => {
  const input = syntheticInput()
  const result = await collectBrowserEvaluation(
    input,
    { inputSha256: hash('input'), productionBuildSha256: hash('build') },
    syntheticProbe(),
  )
  const changed = JSON.parse(JSON.stringify(result.receipt))
  const settlement = changed.rows[0].streams[0].observations.at(-1)
  settlement.baseline.observation = observation('changed')
  settlement.candidate.observation = observation('changed')
  expect(
    validateBrowserEvaluation(input, parseBrowserReceipt(changed)).failures.join(' '),
  ).toContain('settlement differs')
})
