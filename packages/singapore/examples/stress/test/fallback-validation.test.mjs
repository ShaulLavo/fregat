import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  analyze,
  primaryMetrics,
  readResult,
  secondaryMetrics,
  validateExperiment,
  validateFinalBlockCount,
  validateRun,
} from '../fallback-validation.mjs'

const artifact = (name) =>
  fileURLToPath(new URL(`../../../docs/performance/e034-${name}.json.gz`, import.meta.url))
const baseline = await readResult(artifact('before'))
const control = await readResult(artifact('control'))
const candidate = await readResult(artifact('after'))
const orders = [
  ['baseline', 'control', 'candidate'],
  ['control', 'candidate', 'baseline'],
  ['candidate', 'baseline', 'control'],
  ['candidate', 'control', 'baseline'],
  ['control', 'baseline', 'candidate'],
  ['baseline', 'candidate', 'control'],
]
const design = {
  schemaVersion: 1,
  purpose: 'final',
  predeclaredAt: '2020-01-01T00:00:00.000Z',
  seed: 60061,
  bootstrapDraws: 2000,
  familywiseAlpha: 0.05,
  clockQuantumMs: 0.1,
  numericalEpsilonMs: 1e-7,
  regressionMarginMs: 0,
  primaryMetrics,
  secondaryMetrics,
}

it.each([
  ['baseline', baseline],
  ['control', control],
  ['candidate', candidate],
])('validates the checked %s artifact', (_name, run) => {
  expect(validateRun(run)).toBe(run)
})

it.each([
  [
    'empty samples',
    (run) => {
      run.samples = []
    },
  ],
  [
    'missing sample',
    (run) => {
      run.samples.pop()
    },
  ],
  [
    'duplicate sample',
    (run) => {
      run.samples[1] = structuredClone(run.samples[0])
    },
  ],
  [
    'sample hash mismatch',
    (run) => {
      run.samples[0].fixtureHash = '0'.repeat(64)
    },
  ],
  [
    'missing input event',
    (run) => {
      run.samples[0].fallback.bursts[0].events.pop()
    },
  ],
  [
    'invalid input clock',
    (run) => {
      run.samples[0].fallback.bursts[0].events[0].appliedAt = -1
    },
  ],
  [
    'null input clock',
    (run) => {
      run.samples[0].fallback.bursts[0].events[0].appliedAt = null
    },
  ],
  [
    'missing memory snapshot',
    (run) => {
      delete run.samples[0].fallback.initialHeap
    },
  ],
  [
    'retained document',
    (run) => {
      run.samples[0].cleanup.retainedObjects = 1
    },
  ],
  [
    'blank screenshot',
    (run) => {
      run.samples[0].pixels.text.ink = 0
    },
  ],
  [
    'missing callback metric',
    (run) => {
      delete run.samples[0].latencyMs.textCallback
    },
  ],
  [
    'unobserved callback timestamp',
    (run) => {
      run.samples[0].latencyMs.textCallback += 100
    },
  ],
])('rejects %s in recorded results', (_name, mutate) => {
  const run = structuredClone(baseline)
  mutate(run)
  expect(() => validateRun(run)).toThrow()
})

it.each([
  [
    'duplicate events within a burst',
    (bursts) => {
      bursts[0].events[1] = { ...bursts[0].events[0] }
    },
  ],
  [
    'reordered events within a burst',
    (bursts) => {
      const events = bursts[0].events
      ;[events[0], events[1]] = [events[1], events[0]]
    },
  ],
  [
    'duplicate events across bursts',
    (bursts) => {
      bursts[1].events[0] = { ...bursts[0].events.at(-1) }
    },
  ],
  [
    'reordered events across bursts',
    (bursts) => {
      const previous = bursts[0].events
      const next = bursts[1].events
      ;[previous[11], next[0]] = [next[0], previous[11]]
    },
  ],
])('rejects %s', (_name, mutate) => {
  const run = structuredClone(baseline)
  mutate(run.samples[0].fallback.bursts)
  expect(() => validateRun(run)).toThrow(/input event order/)
})

it.each([12, 24])('accepts identical raw data in %s synthetic independent blocks', (count) => {
  expect(analyze(design, syntheticBlocks(count)).acceptance.passed).toBe(true)
})

it.each([0, 6, 11, 13, 23, 12.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects final block count %s',
  (count) => {
    expect(() => validateFinalBlockCount(count)).toThrow(/final block count/)
  },
)

it.each([6, 13])('rejects %s captured blocks in a final analysis', (count) => {
  expect(() => validateExperiment(design, syntheticBlocks(count))).toThrow(/final block count/)
})

it('rejects unbalanced order frequencies in a larger final analysis', () => {
  const blocks = syntheticBlocks(24)
  blocks[0] = syntheticBlock(24, orders[1])
  expect(() => validateExperiment(design, blocks)).toThrow(/balanced order frequency/)
})

it.each([undefined, 0, 2])('rejects warmup count %s', (warmups) => {
  const run = structuredClone(baseline)
  run.config.warmups = warmups
  expect(() => validateRun(run)).toThrow(/warmup coverage/)
})

it.each([undefined, Number.NaN, -1, 0.5, 0x100000000])('rejects bootstrap seed %s', (seed) => {
  expect(() => validateExperiment({ ...design, seed }, syntheticBlocks())).toThrow(/bootstrap seed/)
})

it('retains numerical residue while accepting the strict equality boundary', () => {
  const blocks = syntheticBlocks()
  for (const block of blocks) slow(block.candidate, 3e-8)
  const report = analyze(design, blocks)
  expect(report.acceptance.passed).toBe(true)
  expect(report.metrics.some((metric) => metric.upperMs > 0 && metric.upperMs < 1e-7)).toBe(true)
})

it('detects a synthetic candidate slowdown applied to the raw observations', () => {
  const blocks = syntheticBlocks()
  for (const block of blocks) slow(block.candidate, 25)
  const report = analyze(design, blocks)
  expect(report.acceptance.status).toBe('regression')
  expect(
    report.metrics
      .filter((metric) => metric.family === 'primary')
      .every((metric) => metric.lowerMs > 24),
  ).toBe(true)
})

it('keeps the clock quantization envelope separate from acceptance', () => {
  const blocks = syntheticBlocks()
  for (const block of blocks) slow(block.candidate, 0.1)
  const report = analyze(design, blocks)
  expect(report.acceptance.status).toBe('regression')
  expect(report.metrics.every((metric) => metric.withinQuantizationEnvelope)).toBe(true)
})

it('keeps a nonsignificant candidate shift unresolved', () => {
  const blocks = syntheticBlocks()
  slow(blocks[0].candidate, 1)
  const report = analyze(design, blocks)
  expect(report.acceptance.passed).toBe(false)
  expect(report.acceptance.status).toBe('unresolved')
})

it('rejects candidate acceptance when unchanged controls drift', () => {
  const blocks = syntheticBlocks()
  for (const block of blocks) slow(block.control, 25)
  expect(analyze(design, blocks).acceptance.status).toBe('invalid-control-drift')
})

it.each([
  [
    'browser',
    (blocks) => {
      blocks[0].candidate.environment.browser = 'other-browser'
    },
    /environment mismatch/,
  ],
  [
    'hardware',
    (blocks) => {
      blocks[0].candidate.environment.hardware.cpu = 'other-cpu'
    },
    /environment mismatch/,
  ],
  [
    'control build',
    (blocks) => {
      blocks[0].control.environment.coreBuildHash = '0'.repeat(64)
    },
    /unchanged control/,
  ],
])('rejects a changed %s', (_name, mutate, reason) => {
  const blocks = syntheticBlocks()
  mutate(blocks)
  expect(() => validateExperiment(design, blocks)).toThrow(reason)
})

it('does not derive uncertainty from one browser block', () => {
  const report = analyze({ ...design, purpose: 'pilot' }, [
    { id: 'pilot', order: orders[0], baseline, control, candidate },
  ])
  expect(report.acceptance.status).toBe('pilot-only')
  expect(report.boundsAvailable).toBe(false)
  expect(report.metrics.every((metric) => metric.upperMs === null)).toBe(true)
})

it.each([undefined, 24])(
  'writes a portable %s-block declaration and refuses overwrite',
  async (count) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'editor-fallback-design-'))
    try {
      const output = resolve(directory, 'design.json')
      const script = fileURLToPath(new URL('../fallback-validation-design.mjs', import.meta.url))
      const args = [script, output, resolve(directory, 'captures')]
      if (count !== undefined) args.push(String(count))
      execFileSync(process.execPath, args)
      const original = await readFile(output, 'utf8')
      const generated = JSON.parse(original)
      expect(generated.blocks).toHaveLength(count ?? 12)
      expect(generated.numericalEpsilonMs).toBe(1e-7)
      expect(generated.blocks[0].candidate).toBe('captures/block-01-candidate.json')
      expect(generated.blocks.every((block) => !isAbsolute(block.candidate))).toBe(true)
      for (const order of orders)
        expect(
          generated.blocks.filter((block) => block.order.join() === order.join()),
        ).toHaveLength((count ?? 12) / 6)
      expect(() => execFileSync(process.execPath, args, { stdio: 'pipe' })).toThrow(/EEXIST/)
      expect(await readFile(output, 'utf8')).toBe(original)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

it.each([6, 13, 12.5])('refuses to generate a %s-block declaration', async (count) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'editor-fallback-design-'))
  try {
    const output = resolve(directory, 'design.json')
    const script = fileURLToPath(new URL('../fallback-validation-design.mjs', import.meta.url))
    expect(() =>
      execFileSync(process.execPath, [script, output, directory, String(count)], {
        stdio: 'pipe',
      }),
    ).toThrow(/final block count/)
    expect(await readdir(directory)).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it.each([
  [24, false, /EEXIST/],
  [6, false, /final block count/],
  [13, false, /final block count/],
  [24, true, /balanced order frequency/],
])(
  'checks %s-block runner design, imbalance=%s, before capture',
  async (count, unbalanced, reason) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'editor-fallback-runner-'))
    try {
      const blocks = Array.from({ length: count }, (_, index) => ({
        id: `block-${index}`,
        order: orders[index % orders.length],
        baseline: `block-${index}-baseline.json`,
        control: `block-${index}-control.json`,
        candidate: `block-${index}-candidate.json`,
      }))
      if (unbalanced) blocks[0].order = orders[1]
      const output = resolve(directory, 'design.json')
      const timeline = `${output}.timeline.jsonl`
      await writeFile(output, JSON.stringify({ ...design, blocks }))
      await writeFile(timeline, 'existing timeline')
      const script = fileURLToPath(new URL('../fallback-experiment.mjs', import.meta.url))
      expect(() =>
        execFileSync(
          process.execPath,
          [
            script,
            '--design',
            output,
            '--baseline-core',
            directory,
            '--candidate-core',
            directory,
            '--cpu-affinity',
            '0',
          ],
          {
            stdio: 'pipe',
          },
        ),
      ).toThrow(reason)
      expect(await readFile(timeline, 'utf8')).toBe('existing timeline')
      expect((await readdir(directory)).sort()).toEqual([
        'design.json',
        'design.json.timeline.jsonl',
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

function syntheticBlocks(count = 12) {
  return Array.from({ length: count }, (_, index) => syntheticBlock(index))
}

function syntheticBlock(index, order = orders[index % orders.length]) {
  const block = { id: `block-${index}`, order }
  for (const [position, arm] of order.entries()) {
    block[arm] = structuredClone(baseline)
    block[arm].id = `synthetic-${index}-${arm}`
    block[arm].createdAt = new Date(Date.UTC(2021, 0, 1, index, position)).toISOString()
  }
  return block
}

function slow(run, duration) {
  for (const sample of run.samples) {
    sample.latencyMs.textCallback += duration
    sample.latencyMs.visibleTextUpperBound += duration
    sample.observation.paints.find((paint) => paint.phase === 'text').at += duration
    for (const burst of sample.fallback.bursts) delayEvents(burst.events, duration)
  }
}

function delayEvents(events, duration) {
  for (const event of events) {
    event.appliedAt += duration
    event.frameAt += duration
  }
}
