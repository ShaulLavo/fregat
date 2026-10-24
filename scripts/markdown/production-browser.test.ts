import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import type { Browser } from 'playwright'
import { expect, test, vi } from 'vitest'
import {
  oneTrial,
  readOracle,
  retainBrowserMismatch,
  runProductionMarkdownPairs,
} from './production-browser'
import { productionBrowserWorkloads } from './production-workloads'
import type { ProductionMarkdownFrame } from '../../apps/web/test/factories/markdown-production-types'
import type { ProductionOracleWireRecord } from './production-oracle'
import { qualificationProvenance } from './provenance'

function frame(text: string): ProductionMarkdownFrame {
  const observation = { text, elements: [{ tag: 'p', text, parents: [], attributes: {} }] }
  const output = {
    digest: createHash('sha256').update(JSON.stringify(observation)).digest('hex'),
    textBytes: Buffer.byteLength(text),
    elementCount: 1,
  }
  return {
    ...observation,
    revision: 1,
    observedRevision: 1,
    inputSha256: createHash('sha256').update(text).digest('hex'),
    inputUtf16Units: text.length,
    live: false,
    scheduled: 0,
    received: 0,
    committed: 1,
    painted: 2,
    parseCalls: 1,
    parserWallMs: 0.5,
    output,
    paintedOutput: output,
  }
}
const observed = frame('A')
const records: readonly ProductionOracleWireRecord[] = [
  { kind: 'frame', frame: observed },
  { kind: 'final', frame: observed, fullyReady: 3, longTasks: [], resources: [] },
  { kind: 'fresh', frame: observed },
]

function browserFixture(options: {
  readonly ready: Promise<unknown>
  readonly dispose: () => Promise<void>
  readonly content?: () => Promise<string>
  readonly globals?: Readonly<Record<string, unknown>>
  readonly probe?: Readonly<Record<string, unknown>>
  readonly cdp?: EventEmitter
  readonly records?: readonly unknown[]
}) {
  const initialization = Promise.withResolvers<void>()
  const diagnostics = Promise.withResolvers<void>()
  const disposal = Promise.withResolvers<void>()
  let closed = 0
  const window: Record<string, unknown> = {
    markdownProductionProbe: {
      ...options.probe,
      get ready() {
        initialization.resolve()
        return options.ready
      },
      dispose: () => {
        disposal.resolve()
        return options.dispose()
      },
      streamOracle: async (
        _source: string,
        _chunks: readonly string[],
        sink: (record: unknown) => Promise<void>,
      ) => {
        for (const record of options.records ?? records) await sink(record)
      },
    },
  }
  const page = {
    on() {},
    removeListener() {},
    goto: async () => {},
    workers: () => [],
    context: () => ({ newCDPSession: async () => options.cdp }),
    evaluate: (callback: Function, ...args: unknown[]) =>
      Promise.resolve(
        runInNewContext(`(${callback.toString()})(...args)`, { ...options.globals, window, args }),
      ),
    exposeBinding: async (name: string, callback: Function) => {
      window[name] = (...args: unknown[]) => callback({}, ...args)
    },
    screenshot: async () => {
      diagnostics.resolve()
      return Buffer.alloc(0)
    },
    content: options.content ?? (async () => '<fixture/>'),
  }
  const context = {
    newPage: async () => page,
    close: async () => {
      closed++
    },
  }
  // Fixture browser methods model the external browser protocol, with real producer code above it.
  const browser = {
    newContext: async () => context,
    browserType: () => ({ name: () => 'chromium' }),
  } as unknown as Browser
  return {
    browser,
    initialization: initialization.promise,
    diagnostics: diagnostics.promise,
    disposal: disposal.promise,
    closed: () => closed > 0,
    closedContexts: () => closed,
  }
}

const workload = { ...productionBrowserWorkloads()[0], source: 'A', cache: 'cold' as const }

test('pending initialization, diagnostics and disposal are bounded and context still closes', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'oracle-stalled-'))
  const fixture = browserFixture({
    ready: new Promise(() => {}),
    dispose: () => new Promise(() => {}),
    content: () => new Promise(() => {}),
  })
  vi.useFakeTimers()
  try {
    const result = readOracle(
      fixture.browser,
      'https://fixture.invalid/',
      workload,
      'remark',
      output,
      output,
    )
    const rejected = expect(result).rejects.toThrow('oracle initialization')
    await fixture.initialization
    await vi.advanceTimersByTimeAsync(45_001)
    await fixture.diagnostics
    await vi.advanceTimersByTimeAsync(5001)
    await fixture.disposal
    await vi.advanceTimersByTimeAsync(5001)
    await rejected
    expect(fixture.closed()).toBe(true)
    const cleanup = JSON.parse(await readFile(path.join(output, 'capture-cleanup.json'), 'utf8'))
    expect(cleanup[0].failure).toContain('probe disposal')
    expect(cleanup.at(-1)).toEqual({ operation: 'context close', failure: null })
  } finally {
    vi.useRealTimers()
    await rm(output, { recursive: true, force: true })
  }
})

test('initialization error survives diagnostic and disposal errors', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'oracle-errors-'))
  const original = new TypeError('original fixture initialization failure')
  const fixture = browserFixture({
    ready: Promise.reject(original),
    dispose: async () => {
      throw new TypeError('dispose failed')
    },
    content: async () => {
      throw new TypeError('content failed')
    },
  })
  try {
    await expect(
      readOracle(fixture.browser, 'https://fixture.invalid/', workload, 'remark', output, output),
    ).rejects.toBe(original)
    expect(fixture.closed()).toBe(true)
    const failure = JSON.parse(await readFile(path.join(output, 'oracle-failure.json'), 'utf8'))
    expect(failure.failure).toBe(original.message)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test.each(['relative', 'absolute'] as const)(
  'oracle and mismatch accept %s output paths',
  async (kind) => {
    const output = await mkdtemp(path.join(tmpdir(), 'oracle-paths-'))
    const root = kind === 'absolute' ? output : path.relative(process.cwd(), output)
    const directory = path.join(root, 'fixture', 'pair-0-remark')
    const fixture = browserFixture({ ready: Promise.resolve({}), dispose: async () => {} })
    try {
      await mkdir(directory, { recursive: true })
      const captured = await readOracle(
        fixture.browser,
        'https://fixture.invalid/',
        workload,
        'remark',
        directory,
        root,
      )
      expect(captured.correctness.artifact.path).toBe('fixture/pair-0-remark/oracle.jsonl')
      expect(captured.correctness.artifact.recordCount).toBe(3)
      const file = path.join(directory, 'timing-mismatch.json')
      await retainBrowserMismatch(
        { actual: frame('B'), expected: observed.paintedOutput, expectedIndex: 0 },
        {
          root,
          file,
          engine: 'remark',
          oracle: captured.correctness,
        },
      )
      const mismatch = JSON.parse(await readFile(file, 'utf8'))
      expect(mismatch).toBeDefined()
      expect(fixture.closed()).toBe(true)
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

class TrialSession extends EventEmitter {
  readonly commands: string[] = []
  readonly dataLoss: boolean
  constructor(dataLoss: boolean) {
    super()
    this.dataLoss = dataLoss
  }
  async send(method: string) {
    this.commands.push(method)
    if (method === 'Performance.getMetrics') return { metrics: [] }
    if (method === 'Runtime.getHeapUsage') return { usedSize: 1, totalSize: 1 }
    if (method !== 'Tracing.end') return {}
    this.emit('Tracing.dataCollected', { value: [{ name: 'failed-trial-event', ts: 1 }] })
    this.emit('Tracing.tracingComplete', { dataLossOccurred: this.dataLoss })
    return {}
  }
  async detach() {
    this.commands.push('detach')
  }
}

test.each(['replay', 'scene', 'replay-with-trace-data-loss'] as const)(
  'failed %s retains the original error, raw trace and owned context cleanup',
  async (stage) => {
    const output = await mkdtemp(path.join(tmpdir(), 'production-failed-trial-'))
    const original = new TypeError(`injected ${stage} failure`)
    const source = await qualificationProvenance(process.cwd())
    const manifest = '{}'
    const session = new TrialSession(stage === 'replay-with-trace-data-loss')
    const build = {
      sourceBefore: source,
      sourceAfter: source,
      sourceConsistent: true,
      budgetSha256: 'fixture-budget',
      artifactManifestSha256: createHash('sha256').update(manifest).digest('hex'),
      artifacts: [],
    }
    const fixture = browserFixture({
      ready: Promise.resolve({ engine: 'remark', initializationMs: 1 }),
      dispose: async () => {},
      cdp: session,
      globals: {
        URL,
        location: new URL('https://fixture.invalid/test/markdown-production.html'),
        fetch: async () => ({ status: 200, json: async () => build, text: async () => manifest }),
        navigator: { userAgent: 'fixture', hardwareConcurrency: 1 },
        devicePixelRatio: 1,
        innerWidth: 1440,
        innerHeight: 900,
        document: { body: {}, fonts: [] },
        getComputedStyle: () => ({ fontFamily: 'fixture' }),
      },
      probe: {
        time: async () => {
          if (stage !== 'scene') throw original
          return { processed: [], heldSyntax: null }
        },
        show: async () => {},
        resources: async () => {
          throw original
        },
      },
    })
    try {
      await expect(
        oneTrial({
          browser: fixture.browser,
          url: 'https://fixture.invalid/',
          output,
          workload: { ...workload, scene: 'resources' },
          pair: 0,
          order: 'AB',
          engine: 'remark',
          expectedSource: source,
          expectedBudgetSha256: 'fixture-budget',
          onServedBuild() {},
        }),
      ).rejects.toBe(original)
      const directory = path.join(output, workload.id, 'pair-0-remark')
      const raw = JSON.parse(await readFile(path.join(directory, 'production-trace.json'), 'utf8'))
      expect(raw.traceEvents).toEqual([{ name: 'failed-trial-event', ts: 1 }])
      expect(raw.capture.outcome).toBe('failed')
      expect(raw.capture.status).toBe(session.dataLoss ? 'data-loss' : 'complete')
      const failure = JSON.parse(await readFile(path.join(directory, 'failure.json'), 'utf8'))
      expect(failure.failure).toBe(original.message)
      expect(failure.trace.failure === null).toBe(!session.dataLoss)
      expect(session.commands.filter((command) => command === 'Tracing.end')).toHaveLength(1)
      expect(session.commands.at(-1)).toBe('detach')
      expect(fixture.closedContexts()).toBe(2)
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test('invalid oracle callbacks retain their original record before rejecting the capture', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'oracle-invalid-record-'))
  const invalid = { kind: 'final', frame: observed, fullyReady: -1, longTasks: [], resources: [] }
  const fixture = browserFixture({
    ready: Promise.resolve({}),
    dispose: async () => {},
    records: [invalid],
  })
  try {
    await expect(
      readOracle(fixture.browser, 'https://fixture.invalid/', workload, 'remark', output, output),
    ).rejects.toThrow('record shape is invalid')
    const diagnostic = JSON.parse(await readFile(path.join(output, 'oracle-failure.json'), 'utf8'))
    expect(diagnostic.invalidOracleRecord).toEqual(invalid)
    expect(fixture.closed()).toBe(true)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('diagnostic captures validate supplied actual host evidence before selecting workloads', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'production-host-evidence-'))
  try {
    const file = path.join(directory, 'host.json')
    await writeFile(
      file,
      JSON.stringify({ host: 'different-host', observedAt: new Date().toISOString() }),
    )
    await expect(
      runProductionMarkdownPairs({
        url: 'http://127.0.0.1:1',
        output: path.join(directory, 'capture'),
        workloadIds: [],
        capture: { kind: 'diagnostic', hostEvidenceFile: file },
      }),
    ).rejects.toThrow('Timing-host evidence must name this actual host')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
