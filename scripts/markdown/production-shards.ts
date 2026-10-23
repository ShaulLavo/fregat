import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createScriptError } from '../structured-errors'
import { hashFile, readArtifactBytes } from './timing-artifacts'
import { stable } from './serialization'
import * as v from 'valibot'
import type { ProductionWorkload } from './production-workloads'

const label = v.pipe(v.string(), v.minLength(1))
const digest = v.pipe(label, v.regex(/^[a-f0-9]{64}$/u))
const pair = v.pipe(v.number(), v.integer(), v.minValue(-3), v.maxValue(19))
export const productionShardSelection = v.strictObject({ workload: label, pair })
export const productionShard = v.strictObject({
  ...productionShardSelection.entries,
  index: v.pipe(v.number(), v.integer(), v.minValue(0)),
  planSha256: digest,
  launchId: label,
})
export type ProductionShard = v.InferOutput<typeof productionShard>
export const productionCapturePlan = v.strictObject({
  schemaVersion: v.literal(1),
  kind: v.literal('production-capture-plan'),
  purpose: v.picklist(['development', 'promotion']),
  provenance: v.unknown(),
  budgetSha256: digest,
  build: v.strictObject({ metadataSha256: digest, manifestSha256: digest }),
  workloadManifest: v.unknown(),
  shards: v.pipe(v.array(productionShardSelection), v.minLength(1)),
})
export type ProductionCapturePlan = v.InferOutput<typeof productionCapturePlan>

export function productionShardSelections(workloads: readonly Pick<ProductionWorkload, 'id'>[]) {
  return workloads.flatMap(({ id }) =>
    Array.from({ length: 23 }, (_, index) => ({ workload: id, pair: index - 3 })),
  )
}

export const nativePlanMetadata = v.strictObject({
  seed: v.pipe(v.number(), v.integer(), v.minValue(0)),
  candidateCommit: v.pipe(label, v.regex(/^[a-f0-9]{40}$/u)),
  candidateSourceSha256: digest,
  sourceFiles: v.pipe(v.array(v.strictObject({ path: label, sha256: digest })), v.minLength(1)),
  lockfileSha256: digest,
  budgetSha256: digest,
  grammarSha256: digest,
  chatGrammarSha256: digest,
  resolverSha256: digest,
  workloadManifestSha256: digest,
  qualification: v.looseObject({
    revision: v.pipe(label, v.regex(/^[a-f0-9]{40}$/u)),
    trackedDiffSha256: digest,
    sourceClosureSha256: digest,
    lockfileSha256: digest,
    sources: v.pipe(v.array(v.strictObject({ file: label, sha256: digest })), v.minLength(1)),
    runtime: v.strictObject({ bun: label, node: label, platform: label, architecture: label }),
    curatedSources: v.array(v.unknown()),
    reference: v.record(label, v.unknown()),
    baselineProfile: v.record(label, v.unknown()),
  }),
})
export const nativeCapturePlan = v.strictObject({
  schemaVersion: v.literal(1),
  kind: v.literal('native-capture-plan'),
  purpose: v.picklist(['development', 'qualification']),
  metadata: nativePlanMetadata,
  shards: v.pipe(v.array(productionShardSelection), v.minLength(1)),
})
export function nativeShardSelections(workloads: readonly { readonly id: string }[]) {
  return workloads.flatMap(({ id }) =>
    [-1, -2, -3]
      .concat(Array.from({ length: 20 }, (_, pair) => pair))
      .map((pair) => ({ workload: id, pair })),
  )
}
const capturePlan = v.variant('kind', [productionCapturePlan, nativeCapturePlan])

export const timingSidecarFiles = v.strictObject({
  host: v.nullable(label),
  quietHost: v.nullable(label),
  build: v.nullable(label),
  buildManifest: v.nullable(label),
  browser: v.nullable(label),
  fonts: v.nullable(label),
  trials: label,
  sourceCapture: v.nullable(label),
})
const reference = v.strictObject({ path: label, sha256: digest })
const indexedLaunch = v.strictObject({ report: reference, artifacts: timingSidecarFiles })
export const productionShardIndex = v.strictObject({
  schemaVersion: v.literal(1),
  kind: v.literal('production-shards'),
  plan: reference,
  shards: v.pipe(v.array(indexedLaunch), v.minLength(1), v.maxLength(1978)),
})
export const nativeShardIndex = v.strictObject({
  schemaVersion: v.literal(1),
  kind: v.literal('native-shards'),
  plan: reference,
  shards: v.pipe(v.array(indexedLaunch), v.minLength(1), v.maxLength(1725)),
})
const shardIndex = v.variant('kind', [productionShardIndex, nativeShardIndex])

export const timingLaunchManifest = v.strictObject({
  schemaVersion: v.literal(1),
  kind: v.picklist(['production', 'native']),
  report: label,
  frozen: label,
  artifacts: timingSidecarFiles,
})

async function readCapturedJson(root: string, file: string) {
  const { reference, bytes } = await readArtifactBytes({ root, file })
  const filename = path.resolve(root, reference.path)
  const contents: unknown = JSON.parse(bytes.toString('utf8'))
  return { reference, filename, contents }
}

export async function assembleTimingShards(options: {
  readonly root: string
  readonly planFile: string
  readonly frozenFile: string
  readonly launchManifests: readonly string[]
  readonly output: string
}) {
  const root = await realpath(options.root)
  const observed = await readCapturedJson(root, options.planFile)
  const plan = v.parse(capturePlan, observed.contents)
  const frozen = await hashFile({ root, file: options.frozenFile })
  const output = path.join(
    await realpath(path.dirname(path.resolve(options.output))),
    path.basename(options.output),
  )
  const relative = path.relative(root, output)
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  )
    throw createScriptError('Shard assembly output must stay inside its evidence root.')
  await mkdir(output)
  const shards: Awaited<ReturnType<typeof indexLaunch>>[] = []
  for (const file of options.launchManifests)
    shards.push(
      await indexLaunch({
        root,
        output,
        file,
        plan,
        planSha256: observed.reference.sha256,
        frozenSha256: frozen.sha256,
      }),
    )
  if (new Set(shards.map(({ launchId }) => launchId)).size !== shards.length)
    throw createScriptError('Assembly requires a distinct actual launch identity for every shard.')
  shards.sort((first, second) => first.index - second.index)
  if (shards.length !== plan.shards.length || shards.some((entry, index) => entry.index !== index))
    throw createScriptError('Assembly requires every planned shard exactly once.')
  const kind = plan.kind === 'production-capture-plan' ? 'production' : 'native'
  const indexFile = path.join(output, `${kind}-shards.json`)
  const index = v.parse(shardIndex, {
    schemaVersion: 1,
    kind: `${kind}-shards`,
    plan: { path: path.relative(output, observed.filename), sha256: observed.reference.sha256 },
    shards: shards.map(({ report, artifacts }) => ({ report, artifacts })),
  })
  await writeFile(indexFile, JSON.stringify(index, null, 2) + '\n', { flag: 'wx' })
  const manifestFile = path.join(output, 'timing-manifest.json')
  await writeFile(
    manifestFile,
    JSON.stringify(
      {
        schemaVersion: 2,
        kind,
        report: path.basename(indexFile),
        frozen: path.relative(output, path.resolve(root, frozen.path)),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  )
  return { indexFile, manifestFile }
}

async function indexLaunch(options: {
  readonly root: string
  readonly output: string
  readonly file: string
  readonly plan: v.InferOutput<typeof capturePlan>
  readonly planSha256: string
  readonly frozenSha256: string
}) {
  const observed = await readCapturedJson(options.root, options.file)
  const manifest = v.parse(timingLaunchManifest, observed.contents)
  if (`${manifest.kind}-capture-plan` !== options.plan.kind)
    throw createScriptError('The launch manifest differs from its capture plan domain.')
  const directory = path.dirname(observed.filename)
  const frozen = await hashFile({
    root: options.root,
    file: path.resolve(directory, manifest.frozen),
  })
  if (frozen.sha256 !== options.frozenSha256)
    throw createScriptError('Launch manifests must name the same frozen identity bytes.')
  const report = await readCapturedJson(options.root, path.resolve(directory, manifest.report))
  const { shard } = v.parse(v.object({ shard: productionShard }), report.contents)
  if (
    shard.planSha256 !== options.planSha256 ||
    stable({ workload: shard.workload, pair: shard.pair }) !==
      stable(options.plan.shards[shard.index])
  )
    throw createScriptError('The launch differs from its immutable planned selection.')
  const reportDirectory = path.dirname(report.filename)
  const artifacts = v.parse(
    timingSidecarFiles,
    Object.fromEntries(
      Object.entries(manifest.artifacts).map(([name, file]) => [
        name,
        file === null ? null : path.relative(reportDirectory, path.resolve(directory, file)),
      ]),
    ),
  )
  return {
    index: shard.index,
    launchId: shard.launchId,
    report: {
      path: path.relative(options.output, report.filename),
      sha256: report.reference.sha256,
    },
    artifacts,
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      plan: { type: 'string' },
      frozen: { type: 'string' },
      launches: { type: 'string' },
      out: { type: 'string' },
    },
  })
  if (!values.root || !values.plan || !values.frozen || !values.launches || !values.out)
    throw createScriptError(
      'Choose an evidence root, capture plan, frozen identity, launch-manifest list and absent assembly directory.',
    )
  const launches: unknown = JSON.parse(await readFile(values.launches, 'utf8'))
  await assembleTimingShards({
    root: values.root,
    planFile: values.plan,
    frozenFile: values.frozen,
    output: values.out,
    launchManifests: v.parse(v.array(label), launches),
  })
}
