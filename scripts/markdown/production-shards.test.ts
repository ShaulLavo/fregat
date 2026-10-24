import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import * as v from 'valibot'
import { nativePairWorkloads } from './paired-native'
import { productionBrowserWorkloads } from './production-workloads'
import {
  assembleTimingShards,
  nativeCapturePlan,
  nativeShardIndex,
  nativeShardSelections,
  productionCapturePlan,
  productionShard,
  productionShardIndex,
  productionShardSelections,
  timingLaunchManifest,
} from './production-shards'

const io = vi.hoisted(() => ({
  beforeRead: undefined as undefined | ((file: unknown) => Promise<void>),
  beforeStat: undefined as undefined | ((file: unknown) => Promise<void>),
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      await io.beforeRead?.(args[0])
      return actual.readFile(...args)
    },
    stat: async (...args: Parameters<typeof actual.stat>) => {
      await io.beforeStat?.(args[0])
      return actual.stat(...args)
    },
  }
})

const directories: string[] = []
afterEach(async () => {
  io.beforeRead = undefined
  io.beforeStat = undefined
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
const sha = (value: string) => createHash('sha256').update(value).digest('hex')

function metadata() {
  return {
    seed: 176,
    candidateCommit: 'a'.repeat(40),
    candidateSourceSha256: sha('source'),
    sourceFiles: [{ path: 'source.ts', sha256: sha('source') }],
    lockfileSha256: sha('lock'),
    budgetSha256: sha('budget'),
    grammarSha256: sha('grammar'),
    chatGrammarSha256: sha('chat-grammar'),
    resolverSha256: sha('resolver'),
    workloadManifestSha256: sha('workloads'),
    qualification: {
      revision: 'a'.repeat(40),
      trackedDiffSha256: sha(''),
      sourceClosureSha256: sha('closure'),
      lockfileSha256: sha('lock'),
      sources: [{ file: 'source.ts', sha256: sha('source') }],
      runtime: { bun: '1.4.4', node: '24.22.1', platform: 'darwin', architecture: 'arm64' },
      curatedSources: [],
      reference: { parserRevision: 'b'.repeat(40), assets: [] },
      baselineProfile: { parser: 'remark' },
    },
  }
}

test('native selections preserve all 75 workloads and original negative trial order', () => {
  const workloads = nativePairWorkloads('qualification')
  const selections = nativeShardSelections(workloads)
  expect(workloads).toHaveLength(75)
  expect(selections).toHaveLength(1725)
  expect(new Set(selections.map(({ workload, pair }) => `${workload}:${pair}`)).size).toBe(1725)
  expect(selections.filter(({ pair }) => pair < 0)).toHaveLength(225)
  expect(selections.filter(({ pair }) => pair >= 0)).toHaveLength(1500)
  for (const [index, workload] of workloads.entries()) {
    expect(selections.slice(index * 23, (index + 1) * 23)).toEqual(
      [-1, -2, -3]
        .concat(Array.from({ length: 20 }, (_, pair) => pair))
        .map((pair) => ({ workload: workload.id, pair })),
    )
  }
})

test('browser selections preserve 86 cells and original three warmups', () => {
  const workloads = productionBrowserWorkloads()
  const selections = productionShardSelections(workloads)
  expect(workloads).toHaveLength(86)
  expect(selections).toHaveLength(1978)
  expect(selections.slice(0, 23).map(({ pair }) => pair)).toEqual(
    Array.from({ length: 23 }, (_, index) => index - 3),
  )
})

test('native plan preserves complete qualification identity including execution runtime', () => {
  const input = {
    schemaVersion: 1,
    kind: 'native-capture-plan',
    purpose: 'qualification',
    metadata: metadata(),
    shards: nativeShardSelections(nativePairWorkloads('qualification')),
  }
  expect(v.parse(nativeCapturePlan, input)).toEqual(input)
  expect(
    v.safeParse(nativeCapturePlan, {
      ...input,
      metadata: { ...input.metadata, qualification: undefined },
    }).success,
  ).toBe(false)
  expect(
    v.safeParse(nativeCapturePlan, {
      ...input,
      metadata: {
        ...input.metadata,
        qualification: { ...input.metadata.qualification, runtime: undefined },
      },
    }).success,
  ).toBe(false)
  expect(v.safeParse(nativeCapturePlan, { ...input, purpose: 'promotion' }).success).toBe(false)
  expect(v.safeParse(nativeCapturePlan, { ...input, selections: input.shards }).success).toBe(false)
  expect(
    v.safeParse(productionShard, {
      workload: 'cell',
      pair: 20,
      index: 0,
      planSha256: sha('plan'),
      launchId: 'launch',
    }).success,
  ).toBe(false)
})

async function fixture(kind: 'native' | 'production') {
  const root = await mkdtemp(path.join(tmpdir(), 'capture-shards-'))
  directories.push(root)
  await mkdir(path.join(root, 'launches'))
  const shards = [
    { workload: 'cell', pair: -1 },
    { workload: 'cell', pair: 0 },
  ]
  const plan =
    kind === 'native'
      ? v.parse(nativeCapturePlan, {
          schemaVersion: 1,
          kind: 'native-capture-plan',
          purpose: 'development',
          metadata: metadata(),
          shards,
        })
      : v.parse(productionCapturePlan, {
          schemaVersion: 1,
          kind: 'production-capture-plan',
          purpose: 'development',
          provenance: metadata().qualification,
          budgetSha256: sha('budget'),
          build: { metadataSha256: sha('build'), manifestSha256: sha('manifest') },
          workloadManifest: [],
          shards,
        })
  const planBytes = JSON.stringify(plan)
  await writeFile(path.join(root, 'plan.json'), planBytes)
  await writeFile(path.join(root, 'frozen.json'), '{}')
  const launches = await Promise.all(
    shards.map(async (selection, index) => {
      const directory = path.join(root, 'launches', String(index))
      await mkdir(directory)
      await writeFile(
        path.join(directory, 'report.json'),
        JSON.stringify({
          shard: { ...selection, index, planSha256: sha(planBytes), launchId: `actual-${index}` },
        }),
      )
      const manifest = v.parse(timingLaunchManifest, {
        schemaVersion: 1,
        kind,
        report: 'report.json',
        frozen: '../../frozen.json',
        artifacts: {
          host: 'host.json',
          quietHost: 'quiet-host.json',
          build: null,
          buildManifest: null,
          browser: null,
          fonts: null,
          trials: 'raw.jsonl',
          sourceCapture: 'source.json',
        },
      })
      const filename = path.join(directory, 'timing-manifest.json')
      await writeFile(filename, JSON.stringify(manifest))
      return filename
    }),
  )
  return {
    root,
    planFile: 'plan.json',
    frozenFile: 'frozen.json',
    launchManifests: launches,
    output: path.join(root, 'assembly'),
  }
}

test.each(['native', 'production'] as const)(
  'assembly preserves %s original report hashes and report-relative sidecars',
  async (kind) => {
    const options = await fixture(kind)
    const assembled = await assembleTimingShards({
      ...options,
      launchManifests: options.launchManifests.toReversed(),
    })
    const schema = kind === 'native' ? nativeShardIndex : productionShardIndex
    const index = v.parse(schema, JSON.parse(await readFile(assembled.indexFile, 'utf8')))
    expect(index.kind).toBe(`${kind}-shards`)
    expect(index.shards).toHaveLength(2)
    expect(index.shards[0]?.report.path).toBe('../launches/0/report.json')
    const original = await readFile(path.join(options.root, 'launches/0/report.json'), 'utf8')
    expect(index.shards[0]?.report.sha256).toBe(sha(original))
    expect(index.shards[0]?.artifacts.trials).toBe('raw.jsonl')
    expect(JSON.parse(await readFile(assembled.manifestFile, 'utf8'))).toEqual({
      schemaVersion: 2,
      kind,
      report: `${kind}-shards.json`,
      frozen: '../frozen.json',
    })
    await expect(assembleTimingShards(options)).rejects.toThrow()
  },
)

test.each(['missing', 'duplicate', 'changed-plan', 'changed-freeze', 'wrong-domain'] as const)(
  'assembly rejects %s original launch coverage',
  async (failure) => {
    const options = await fixture('native')
    if (failure === 'missing') options.launchManifests.pop()
    if (failure === 'duplicate')
      options.launchManifests.splice(1, 1, ...options.launchManifests.slice(0, 1))
    if (failure === 'changed-plan')
      await writeFile(
        path.join(options.root, 'plan.json'),
        (await readFile(path.join(options.root, 'plan.json'), 'utf8')) + '\n',
      )
    if (failure === 'changed-freeze') {
      await writeFile(path.join(options.root, 'launches/0/other-freeze.json'), '{"changed":true}')
      const filename = path.join(options.root, 'launches/0/timing-manifest.json')
      const manifest = JSON.parse(await readFile(filename, 'utf8'))
      await writeFile(filename, JSON.stringify({ ...manifest, frozen: 'other-freeze.json' }))
    }
    if (failure === 'wrong-domain') {
      const filename = path.join(options.root, 'launches/0/timing-manifest.json')
      const manifest = JSON.parse(await readFile(filename, 'utf8'))
      await writeFile(filename, JSON.stringify({ ...manifest, kind: 'production' }))
    }
    await expect(assembleTimingShards(options)).rejects.toThrow()
  },
)

test.each(['native', 'production'] as const)(
  'assembly rejects a reused actual %s launch identity across distinct selections',
  async (kind) => {
    const options = await fixture(kind)
    const filename = path.join(options.root, 'launches/1/report.json')
    const report = JSON.parse(await readFile(filename, 'utf8'))
    report.shard.launchId = 'actual-0'
    await writeFile(filename, JSON.stringify(report))
    await expect(assembleTimingShards(options)).rejects.toThrow(
      'Assembly requires a distinct actual launch identity for every shard.',
    )
  },
)

async function replacement(root: string, target: 'plan' | 'manifest' | 'report') {
  const paths = {
    plan: 'plan.json',
    manifest: 'launches/0/timing-manifest.json',
    report: 'launches/0/report.json',
  }
  const filename = path.join(root, paths[target])
  const contents = JSON.parse(await readFile(filename, 'utf8'))
  if (target === 'plan') contents.purpose = 'qualification'
  if (target === 'manifest') contents.artifacts.host = 'replacement-host.json'
  if (target === 'report') contents.shard.launchId = 'replacement-launch'
  const temporary = path.join(root, 'replacement.json')
  await writeFile(temporary, JSON.stringify(contents))
  return { filename, temporary }
}

test.each(['plan', 'manifest', 'report'] as const)(
  'assembly binds the hashed %s bytes to parsed data without reopening the file',
  async (target) => {
    const options = await fixture('native')
    const swapped = await replacement(options.root, target)
    io.beforeRead = async (file) => {
      if (String(file) !== swapped.filename) return
      io.beforeRead = undefined
      await rename(swapped.temporary, swapped.filename)
    }
    const assembled = await assembleTimingShards(options)
    io.beforeRead = undefined
    const index = v.parse(nativeShardIndex, JSON.parse(await readFile(assembled.indexFile, 'utf8')))
    expect(index.plan.sha256).toBe(
      sha(await readFile(path.join(options.root, 'plan.json'), 'utf8')),
    )
    expect(index.shards[0]?.report.sha256).toBe(
      sha(await readFile(path.join(options.root, 'launches/0/report.json'), 'utf8')),
    )
    expect(index.shards[0]?.artifacts.host).toBe('host.json')
  },
)

test.each(['plan', 'manifest', 'report'] as const)(
  'assembly rejects a conflicting %s file observation during the identity-checked read',
  async (target) => {
    const options = await fixture('native')
    const swapped = await replacement(options.root, target)
    io.beforeStat = async (file) => {
      if (String(file) !== swapped.filename) return
      io.beforeStat = undefined
      await rename(swapped.temporary, swapped.filename)
    }
    await expect(assembleTimingShards(options)).rejects.toThrow('file changed while reading')
    io.beforeStat = undefined
    await expect(readFile(path.join(options.output, 'native-shards.json'))).rejects.toThrow()
    await expect(readFile(path.join(options.output, 'timing-manifest.json'))).rejects.toThrow()
  },
)
