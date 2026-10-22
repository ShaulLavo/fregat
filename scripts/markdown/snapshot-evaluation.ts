import { hash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { array, boolean, object, parse, string } from 'valibot'
import { MARKDOWN_CASES } from '../../packages/markdown/test/fixtures/cases'
import commonmark from '../../packages/markdown/test/reference/commonmark.json'
import gfm from '../../packages/markdown/test/reference/gfm.json'
import chat from '../../packages/markdown/test/reference/chat.json'
import { createScriptError } from '../structured-errors'
import {
  curationFreezeSchema,
  exclusionsSchema,
  exclusionHashes,
  evaluationManifestSchema,
  sourceIdentity,
  validateCustodyInventory,
  validateCurationProtocol,
  type CurationFreeze,
  type Exclusions,
  type ProspectiveRegistration,
} from './evaluation-custody'
import { encoded } from './serialization'

const DATASET = {
  dataset: 'OpenAssistant/oasst1',
  revision: 'fdf72ae0827c1cda404aff25b6603abec9e3399b',
  license: 'Apache-2.0',
  url: 'https://huggingface.co/datasets/OpenAssistant/oasst1',
}
const messageSchema = object({
  message_id: string(),
  text: string(),
  role: string(),
  lang: string(),
  synthetic: boolean(),
  deleted: boolean(),
  created_date: string(),
})

function parseSourceRow(line: string, index: number) {
  try {
    return parse(messageSchema, JSON.parse(line))
  } catch (error) {
    throw createScriptError('A dataset row requires valid message metadata and text.', {
      internal: {
        boundary: 'selection-source-row',
        rowIndex: index,
        errorType: error instanceof Error ? error.name : typeof error,
      },
    })
  }
}

export function selectEvaluationMessages(raw: string, excluded: ReadonlySet<string>) {
  const seen = new Set(excluded)
  const candidates = []
  const ids = new Set<string>()
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue
    const message = parseSourceRow(line, index)
    if (message.role !== 'assistant' || message.synthetic || message.deleted) continue
    const length = Array.from(message.text).length
    if (message.lang !== 'en' || length < 150 || length > 16384) continue
    if (!/\n|`|\*\*|\[[^\]]+\]\(/u.test(message.text)) continue
    const sha256 = hash('sha256', message.text, 'hex')
    if (
      !message.message_id.trim() ||
      ids.has(message.message_id) ||
      !Number.isFinite(Date.parse(message.created_date))
    )
      throw createScriptError('Selection requires unique attributable message identities.', {
        internal: { boundary: 'selection-message-id' },
      })
    ids.add(message.message_id)
    if (seen.has(sha256)) continue
    seen.add(sha256)
    candidates.push({
      priority: hash('sha256', `fregat-chat-evaluation-v1:${message.message_id}`, 'hex'),
      row: {
        id: message.message_id,
        source: message.text,
        sha256,
        createdDate: message.created_date,
        provenance: DATASET,
        split: 'evaluation',
      },
    })
  }
  candidates.sort((left, right) => left.priority.localeCompare(right.priority))
  return candidates.map((candidate) => candidate.row)
}

export async function curateEvaluationSnapshot(input: {
  readonly asset: string
  readonly license: string
  readonly expectedAssetSha256: string
  readonly expectedLicenseSha256: string
  readonly excludeManifest: string
  readonly freezeManifest: string
  readonly manifestFile: string
  readonly custodyFile: string
  readonly firstBatch: number
  readonly batches: number
  readonly out: string
  readonly builtInExcluded: ReadonlySet<string>
  readonly invocation: readonly string[]
}) {
  const selectionStartedAt = new Date().toISOString()
  await requireUnusedOutput(input.out)
  if (
    !/^[a-f0-9]{64}$/u.test(input.expectedAssetSha256) ||
    !Number.isInteger(input.firstBatch) ||
    input.firstBatch < 1 ||
    !Number.isInteger(input.batches) ||
    input.batches < 1 ||
    input.firstBatch + input.batches > 1000
  )
    throw createScriptError('Selection requires a pinned asset and a valid whole-batch range.', {
      internal: { boundary: 'selection-options' },
    })
  const manifestBytes = await readFile(input.manifestFile)
  const manifest = parse(evaluationManifestSchema, JSON.parse(manifestBytes.toString('utf8')))
  const inventory = validateCustodyInventory(
    JSON.parse(await readFile(input.custodyFile, 'utf8')),
    manifest,
  )
  const exclusions: Exclusions = parse(
    exclusionsSchema,
    JSON.parse(await readFile(input.excludeManifest, 'utf8')),
  )
  const freeze: CurationFreeze = parse(
    curationFreezeSchema,
    JSON.parse(await readFile(input.freezeManifest, 'utf8')),
  )
  validateCurationProtocol(freeze, exclusions, selectionStartedAt)
  const excluded = exclusionHashes(exclusions)
  if (Array.from(input.builtInExcluded).some((source) => !excluded.has(source)))
    throw createScriptError(
      'The complete exclusions manifest must include every built-in development source.',
      { internal: { boundary: 'built-in-exclusions' } },
    )
  for (const batch of manifest.batches)
    for (const source of batch.sourceSha256) excluded.add(source)
  const names = Array.from(
    { length: input.batches },
    (_, index) => `oasst1-batch-${String(input.firstBatch + index).padStart(3, '0')}.json.gz`,
  )
  if (names.some((file) => manifest.batches.some((batch) => batch.file === file)))
    throw createScriptError('Choose unused prospective batch names.', {
      internal: { boundary: 'selection-batch-name' },
    })
  const bytes = await readFile(input.asset)
  const license = await readFile(input.license)
  if (
    hash('sha256', bytes) !== input.expectedAssetSha256 ||
    manifest.assetSha256 !== input.expectedAssetSha256 ||
    hash('sha256', license) !== input.expectedLicenseSha256 ||
    manifest.dataset !== DATASET.dataset ||
    manifest.revision !== DATASET.revision ||
    manifest.license !== DATASET.license
  )
    throw createScriptError('The pinned source or license differs from the curation inputs.', {
      internal: { boundary: 'selection-source-integrity' },
    })
  const rows = selectEvaluationMessages(gunzipSync(bytes).toString('utf8'), excluded)
  if (rows.length < input.batches * 100)
    throw createScriptError(
      'The dataset cannot supply the requested complete evaluation batches.',
      { internal: { eligible: rows.length, required: input.batches * 100 } },
    )
  const assets = names.map((file, index) => {
    const selected = rows.slice(index * 100, (index + 1) * 100)
    const payload = `${JSON.stringify(selected)}\n`
    const compressed = gzipSync(payload, { level: 9 })
    compressed[9] = 255
    return {
      compressed,
      batch: {
        file,
        messages: 100 as const,
        sourceSha256: selected.map((message) => message.sha256),
        assetSha256: hash('sha256', compressed),
        uncompressedSha256: hash('sha256', payload),
        status: 'sealed' as const,
      },
    }
  })
  const selectionCompletedAt = new Date().toISOString()
  const selectorBytes = await readFile(new URL('./snapshot-evaluation.ts', import.meta.url))
  const registrations: ProspectiveRegistration[] = assets.map(({ batch }) => ({
    kind: 'prospective-registration',
    batch,
    source: sourceIdentity(manifest),
    licenseSha256: hash('sha256', license),
    selectorSha256: hash('sha256', selectorBytes),
    exclusions,
    exclusionsSha256: hash('sha256', encoded(exclusions)),
    freeze,
    selectionStartedAt,
    selectionCompletedAt,
    registeredAt: new Date().toISOString(),
    invocation: Array.from(input.invocation),
  }))
  const updated = {
    ...manifest,
    batches: manifest.batches.concat(assets.map(({ batch }) => batch)),
  }
  const custody = validateCustodyInventory(
    { ...inventory, records: inventory.records.concat(registrations) },
    updated,
  )
  const output = path.resolve(input.out)
  await mkdir(output)
  for (const { compressed, batch } of assets)
    await writeFile(path.join(output, batch.file), compressed, { flag: 'wx' })
  await writeFile(path.join(output, 'previous-manifest.json'), manifestBytes, {
    flag: 'wx',
  })
  await writeFile(path.join(output, 'manifest.json'), encoded(updated), {
    flag: 'wx',
  })
  await writeFile(path.join(output, 'custody.json'), encoded(custody), {
    flag: 'wx',
  })
  await writeFile(path.join(output, 'LICENSE'), license, { flag: 'wx' })
  const metadata = {
    schemaVersion: 1,
    eligible: rows.length,
    sealedBatches: assets.length,
    priorManifestSha256: hash('sha256', manifestBytes),
    excludedSourceCount: excluded.size,
    registrations,
  }
  await writeFile(path.join(output, 'selection.json'), encoded(metadata), {
    flag: 'wx',
  })
  return { eligible: rows.length, sealedBatches: assets.length }
}

async function requireUnusedOutput(output: string) {
  const existing = await lstat(output).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  })
  if (existing)
    throw createScriptError('Selection requires a new empty output directory.', {
      internal: { boundary: 'exclusive-selection-output' },
    })
}

async function builtInExclusions() {
  const excluded = new Set(commonmark.concat(gfm).map((example) => hash('sha256', example.source)))
  for (const source of chat) excluded.add(hash('sha256', source))
  for (const fixture of MARKDOWN_CASES) excluded.add(fixture.sha256)
  const repositories = parse(
    array(object({ text: string() })),
    JSON.parse(
      gunzipSync(
        await readFile(
          new URL('../../packages/markdown/test/reference/repositories.json.gz', import.meta.url),
        ),
      ).toString('utf8'),
    ),
  )
  for (const document of repositories) excluded.add(hash('sha256', document.text))
  return excluded
}

async function main() {
  const { values } = parseArgs({
    options: {
      asset: { type: 'string' },
      license: { type: 'string' },
      out: { type: 'string' },
      'exclude-manifest': { type: 'string' },
      'freeze-manifest': { type: 'string' },
      'expected-asset-sha256': { type: 'string' },
      'first-batch': { type: 'string' },
      batches: { type: 'string' },
    },
  })
  if (
    !values.asset ||
    !values.license ||
    !values.out ||
    !values['exclude-manifest'] ||
    !values['freeze-manifest'] ||
    !values['expected-asset-sha256'] ||
    !values['first-batch'] ||
    !values.batches
  )
    throw createScriptError(
      'Prospective selection needs asset, license, output, exclusions, freeze, pinned digest and batch range.',
      { internal: { boundary: 'evaluation-arguments' } },
    )
  const directory = new URL('../../packages/markdown/test/evaluation/', import.meta.url)
  const result = await curateEvaluationSnapshot({
    asset: values.asset,
    license: values.license,
    out: values.out,
    expectedAssetSha256: values['expected-asset-sha256'],
    expectedLicenseSha256: hash('sha256', await readFile(new URL('LICENSE', directory))),
    excludeManifest: values['exclude-manifest'],
    freezeManifest: values['freeze-manifest'],
    manifestFile: fileURLToPath(new URL('manifest.json', directory)),
    custodyFile: fileURLToPath(new URL('custody.json', directory)),
    firstBatch: Number(values['first-batch']),
    batches: Number(values.batches),
    builtInExcluded: await builtInExclusions(),
    invocation: process.argv,
  })
  process.stdout.write(encoded(result))
}

if (import.meta.main) await main()
