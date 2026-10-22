import { hash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  array,
  literal,
  object,
  parse,
  picklist,
  pipe,
  regex,
  string,
  union,
  type InferOutput,
} from 'valibot'
import { createScriptError } from '../structured-errors'
import { encoded, stable } from './serialization'

const sha = pipe(string(), regex(/^[a-f0-9]{64}$/u))
const commit = pipe(string(), regex(/^[a-f0-9]{40}$/u))
const time = pipe(string(), regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u))
export const evaluationBatchSchema = object({
  file: pipe(string(), regex(/^oasst1-batch-[0-9]{3}\.json\.gz$/u)),
  messages: literal(100),
  sourceSha256: array(sha),
  assetSha256: sha,
  uncompressedSha256: sha,
  status: picklist(['sealed', 'exposed', 'retired', 'development']),
})
const sourceSchema = object({
  dataset: string(),
  revision: commit,
  license: string(),
  asset: string(),
  assetSha256: sha,
})
export const evaluationManifestSchema = object({
  schemaVersion: literal(1),
  ...sourceSchema.entries,
  selection: string(),
  batches: array(evaluationBatchSchema),
})
export const EXCLUSION_GROUPS = [
  'commonmark',
  'gfm',
  'chat',
  'owned-cases',
  'repositories',
  'regressions',
  'messages',
  'stories',
  'workloads',
] as const
export const exclusionsSchema = object({
  schemaVersion: literal(1),
  complete: literal(true),
  recordedAt: time,
  groups: array(
    object({
      name: picklist(EXCLUSION_GROUPS),
      sourceSha256: array(sha),
    }),
  ),
})
export const curationFreezeSchema = object({
  curator: string(),
  custodyStartedAt: time,
  ledgerDirectory: string(),
  parserFreeze: object({
    commit,
    sourceSha256: sha,
    artifactsSha256: sha,
    frozenAt: time,
  }),
})
const legacySchema = object({
  kind: literal('legacy-unknown'),
  eligible: literal(false),
  batch: evaluationBatchSchema,
})
const registrationSchema = object({
  kind: literal('prospective-registration'),
  batch: evaluationBatchSchema,
  source: sourceSchema,
  licenseSha256: sha,
  selectorSha256: sha,
  exclusions: exclusionsSchema,
  exclusionsSha256: sha,
  freeze: curationFreezeSchema,
  selectionStartedAt: time,
  selectionCompletedAt: time,
  registeredAt: time,
  invocation: array(string()),
})
const custodySchema = object({
  schemaVersion: literal(1),
  legacyManifestSha256: sha,
  records: array(union([legacySchema, registrationSchema])),
})
export type EvaluationManifest = InferOutput<typeof evaluationManifestSchema>
export type CustodyInventory = InferOutput<typeof custodySchema>
export type ProspectiveRegistration = InferOutput<typeof registrationSchema>
export type Exclusions = InferOutput<typeof exclusionsSchema>
export type CurationFreeze = InferOutput<typeof curationFreezeSchema>

function refuse(boundary: string): never {
  throw createScriptError(
    'Evaluation custody requires a complete matching prospective registration.',
    {
      internal: { boundary },
    },
  )
}

export function exclusionHashes(exclusions: Exclusions) {
  const names = exclusions.groups.map((group) => group.name)
  if (new Set(names).size !== EXCLUSION_GROUPS.length || names.length !== EXCLUSION_GROUPS.length)
    refuse('complete-development-exclusions')
  if (!Number.isFinite(Date.parse(exclusions.recordedAt))) refuse('exclusions-time')
  return new Set(exclusions.groups.flatMap((group) => group.sourceSha256))
}

export function validateCurationProtocol(
  freeze: CurationFreeze,
  exclusions: Exclusions,
  selectionStartedAt: string,
) {
  const times = [
    freeze.parserFreeze.frozenAt,
    freeze.custodyStartedAt,
    exclusions.recordedAt,
    selectionStartedAt,
  ].map(Date.parse)
  if (
    times.some(
      (value, index) =>
        !Number.isFinite(value) || value > Date.now() || value < (times[index - 1] ?? value),
    )
  )
    refuse('preselection-time-order')
  if (
    !freeze.curator.trim() ||
    !path.isAbsolute(freeze.ledgerDirectory) ||
    path.resolve(freeze.ledgerDirectory) !== freeze.ledgerDirectory
  )
    refuse('custody-authority')
}

function validateRegistration(record: ProspectiveRegistration) {
  validateCurationProtocol(record.freeze, record.exclusions, record.selectionStartedAt)
  const excluded = exclusionHashes(record.exclusions)
  if (hash('sha256', encoded(record.exclusions)) !== record.exclusionsSha256)
    refuse('exclusions-identity')
  if (record.batch.sourceSha256.some((source) => excluded.has(source)))
    refuse('development-overlap')
  const times = [record.selectionStartedAt, record.selectionCompletedAt, record.registeredAt].map(
    Date.parse,
  )
  if (
    times.some(
      (value, index) =>
        !Number.isFinite(value) || value > Date.now() || value < (times[index - 1] ?? value),
    )
  )
    refuse('custody-time-order')
  if (!record.invocation.length) refuse('curation-invocation')
}

export function validateCustodyInventory(value: unknown, manifest: EvaluationManifest) {
  const inventory = parse(custodySchema, value)
  const files = new Set<string>()
  const sources = new Set<string>()
  for (const record of inventory.records) {
    const batch = record.batch
    if (
      files.has(batch.file) ||
      batch.sourceSha256.length !== 100 ||
      new Set(batch.sourceSha256).size !== 100
    )
      refuse('custody-batch-identity')
    if (batch.sourceSha256.some((source) => sources.has(source))) refuse('prior-source-membership')
    files.add(batch.file)
    for (const source of batch.sourceSha256) sources.add(source)
    if (record.kind === 'prospective-registration') validateRegistration(record)
  }
  const manifestFiles = manifest.batches.map((batch) => batch.file)
  if (new Set(manifestFiles).size !== manifestFiles.length) refuse('duplicate-manifest-batch')
  if (manifest.batches.some((batch) => !files.has(batch.file))) refuse('missing-registration')
  for (const record of inventory.records) {
    const batch = manifest.batches.find((entry) => entry.file === record.batch.file)
    if (!batch || stable(batch) !== stable(record.batch)) refuse('custody-manifest-identity')
    if (
      record.kind === 'prospective-registration' &&
      stable(record.source) !== stable(sourceIdentity(manifest))
    )
      refuse('custody-source-identity')
  }
  return inventory
}

export function sourceIdentity(manifest: EvaluationManifest) {
  const { dataset, revision, license, asset, assetSha256 } = manifest
  return { dataset, revision, license, asset, assetSha256 }
}

export async function requireEvaluationCustody(input: {
  readonly root: string
  readonly batch: InferOutput<typeof evaluationBatchSchema>
  readonly manifestSha256: string
  readonly artifactsSha256: string
  readonly ledgerDirectory: string
}) {
  const directory = path.join(input.root, 'packages/markdown/test/evaluation')
  const manifestBytes = await readFile(path.join(directory, 'manifest.json'))
  const manifest = parse(evaluationManifestSchema, JSON.parse(manifestBytes.toString('utf8')))
  const inventory = validateCustodyInventory(
    JSON.parse(await readFile(path.join(directory, 'custody.json'), 'utf8')),
    manifest,
  )
  if (hash('sha256', manifestBytes) !== input.manifestSha256) refuse('custody-manifest-digest')
  const record = inventory.records.find((entry) => entry.batch.file === input.batch.file)
  if (!record || record.kind !== 'prospective-registration')
    refuse('prospective-registration-required')
  if (record.freeze.parserFreeze.artifactsSha256 !== input.artifactsSha256)
    refuse('preselection-artifacts')
  if (stable(record.batch) !== stable(input.batch)) refuse('registered-batch-mismatch')
  if (path.resolve(input.ledgerDirectory) !== record.freeze.ledgerDirectory)
    refuse('authoritative-ledger')
  if (hash('sha256', await readFile(path.join(directory, 'LICENSE'))) !== record.licenseSha256)
    refuse('custody-license-identity')
  if (
    hash(
      'sha256',
      await readFile(path.join(input.root, 'scripts/markdown/snapshot-evaluation.ts')),
    ) !== record.selectorSha256
  )
    refuse('custody-selector-identity')
  return record
}
