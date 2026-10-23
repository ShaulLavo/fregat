import { DEVELOPMENT_POLICY_SHA256 } from './development-exclusions'
import { hash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, test } from 'vitest'
import {
  EXCLUSION_GROUPS,
  requireEvaluationCustody,
  validateCustodyInventory,
  type CustodyInventory,
  type EvaluationManifest,
  type ProspectiveRegistration,
} from './evaluation-custody'
import { encoded } from './serialization'

const temporary = new Set<string>()
afterEach(async () => {
  for (const directory of temporary) await rm(directory, { recursive: true, force: true })
  temporary.clear()
})
const digest = (value: string) => hash('sha256', value)
const time = '2026-01-01T00:00:00.000Z'
function fixture() {
  const batch = {
    file: 'oasst1-batch-004.json.gz',
    messages: 100 as const,
    sourceSha256: Array.from({ length: 100 }, (_, index) => digest(`synthetic-${index}`)),
    assetSha256: digest('gzip'),
    uncompressedSha256: digest('payload'),
    status: 'sealed' as const,
  }
  const source = {
    dataset: 'synthetic',
    revision: 'b'.repeat(40),
    license: 'MIT',
    asset: 'source.gz',
    assetSha256: digest('source'),
  }
  const manifest: EvaluationManifest = {
    schemaVersion: 1,
    ...source,
    selection: 'synthetic controls',
    batches: [batch],
  }
  const exclusions = {
    schemaVersion: 1 as const,
    complete: true as const,
    recordedAt: time,
    groups: EXCLUSION_GROUPS.map((name) => ({
      name,
      sourceSha256: [digest('development')],
    })),
  }
  const registration: ProspectiveRegistration = {
    kind: 'prospective-registration',
    batch,
    source,
    licenseSha256: digest('license'),
    selectorSha256: digest('selector'),
    exclusions,
    exclusionsSha256: digest(encoded(exclusions)),
    freeze: {
      developmentPolicySha256: DEVELOPMENT_POLICY_SHA256,
      curator: 'synthetic-control',
      custodyStartedAt: time,
      ledgerDirectory: path.resolve(tmpdir(), 'synthetic-exposures'),
      parserFreeze: {
        commit: 'a'.repeat(40),
        sourceSha256: digest('parser'),
        artifactsSha256: digest('artifacts'),
        frozenAt: time,
      },
    },
    selectionStartedAt: time,
    selectionCompletedAt: time,
    registeredAt: time,
    invocation: ['synthetic-control'],
  }
  const inventory: CustodyInventory = {
    schemaVersion: 1,
    legacyManifestSha256: digest('legacy'),
    records: [registration],
  }
  return { batch, manifest, registration, inventory }
}

test('fresh complete synthetic registration passes; legacy unknown and missing registration refuse', () => {
  const { manifest, inventory, batch } = fixture()
  expect(validateCustodyInventory(inventory, manifest)).toEqual(inventory)
  const legacy = {
    ...inventory,
    records: [{ kind: 'legacy-unknown', eligible: false, batch }],
  }
  expect(validateCustodyInventory(legacy, manifest).records[0]?.kind).toBe('legacy-unknown')
  expect(() => validateCustodyInventory({ ...inventory, records: [] }, manifest)).toThrow()
})

test('recompression and old membership cannot give the same sources a second identity', () => {
  const { manifest, inventory, registration, batch } = fixture()
  const payload = encoded(batch.sourceSha256)
  const old = {
    ...batch,
    file: 'oasst1-batch-001.json.gz',
    assetSha256: hash('sha256', gzipSync(payload, { level: 1 })),
    uncompressedSha256: digest(payload),
  }
  const recompressed = {
    ...batch,
    assetSha256: hash('sha256', gzipSync(payload, { level: 9 })),
    uncompressedSha256: digest(payload),
  }
  expect(old.assetSha256).not.toBe(recompressed.assetSha256)
  const changed = {
    ...inventory,
    records: [
      { kind: 'legacy-unknown', eligible: false, batch: old },
      { ...registration, batch: recompressed },
    ],
  }
  expect(() =>
    validateCustodyInventory(changed, { ...manifest, batches: [old, recompressed] }),
  ).toThrow()
})

test('development overlap, incomplete exclusion groups, duplicate source and manifest mismatches refuse', () => {
  const { manifest, inventory, registration, batch } = fixture()
  for (const changed of [
    {
      ...registration,
      batch: {
        ...batch,
        sourceSha256: [digest('development')].concat(batch.sourceSha256.slice(1)),
      },
    },
    { ...registration, exclusions: { ...registration.exclusions, groups: [] } },
    {
      ...registration,
      batch: {
        ...batch,
        sourceSha256: Array.from({ length: 100 }, () => digest('same')),
      },
    },
    { ...registration, selectionStartedAt: '2025-01-01T00:00:00.000Z' },
    {
      ...registration,
      batch: { ...batch, assetSha256: digest('recompression') },
    },
  ])
    expect(() => validateCustodyInventory({ ...inventory, records: [changed] }, manifest)).toThrow()
})

test('actual sibling inventory gates access and pins ledger, selector and license bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'markdown-custody-control-'))
  temporary.add(root)
  const directory = path.join(root, 'packages/markdown/test/evaluation')
  await mkdir(directory, { recursive: true })
  await mkdir(path.join(root, 'scripts/markdown'), { recursive: true })
  for (const name of ['development-exclusions.ts', 'development-exclusion-policy.json'])
    await writeFile(
      path.join(root, 'scripts/markdown', name),
      await readFile(new URL(name, import.meta.url)),
    )
  const { manifest, inventory, registration, batch } = fixture()
  const manifestBytes = encoded(manifest)
  await writeFile(path.join(directory, 'manifest.json'), manifestBytes)
  await writeFile(path.join(directory, 'LICENSE'), 'license')
  await writeFile(path.join(root, 'scripts/markdown/snapshot-evaluation.ts'), 'selector')
  const input = {
    root,
    batch,
    manifestSha256: digest(manifestBytes),
    artifactsSha256: digest('artifacts'),
    ledgerDirectory: registration.freeze.ledgerDirectory,
  }
  await expect(requireEvaluationCustody(input)).rejects.toThrow()
  await writeFile(path.join(directory, 'custody.json'), encoded(inventory))
  await expect(requireEvaluationCustody(input)).resolves.toEqual(registration)
  await expect(requireEvaluationCustody({ ...input, ledgerDirectory: root })).rejects.toThrow()
  await expect(
    requireEvaluationCustody({ ...input, artifactsSha256: digest('changed artifacts') }),
  ).rejects.toThrow()
  await expect(
    requireEvaluationCustody({ ...input, manifestSha256: digest('changed manifest') }),
  ).rejects.toThrow()
  await expect(
    requireEvaluationCustody({
      ...input,
      batch: { ...batch, assetSha256: digest('recompressed') },
    }),
  ).rejects.toThrow()
  await writeFile(path.join(root, 'scripts/markdown/snapshot-evaluation.ts'), 'changed selector')
  await expect(requireEvaluationCustody(input)).rejects.toThrow()
  await writeFile(path.join(root, 'scripts/markdown/snapshot-evaluation.ts'), 'selector')
  await writeFile(
    path.join(directory, 'custody.json'),
    encoded({
      ...inventory,
      records: [{ kind: 'legacy-unknown', eligible: false, batch }],
    }),
  )
  await expect(requireEvaluationCustody(input)).rejects.toThrow()
  await writeFile(path.join(directory, 'custody.json'), encoded(inventory))
  await writeFile(path.join(directory, 'LICENSE'), 'changed')
  await expect(requireEvaluationCustody(input)).rejects.toThrow()
  expect(await readFile(path.join(directory, 'manifest.json'), 'utf8')).toBe(manifestBytes)
})

test('committed quarantine preserves every original batch identity and all 300 legacy source hashes', async () => {
  const manifestBytes = await readFile(
    new URL('../../packages/markdown/test/evaluation/manifest.json', import.meta.url),
  )
  const inventory = JSON.parse(
    await readFile(
      new URL('../../packages/markdown/test/evaluation/custody.json', import.meta.url),
      'utf8',
    ),
  )
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const parsed = validateCustodyInventory(inventory, manifest)
  expect(parsed.legacyManifestSha256).toBe(
    '53853bdbf63caf62988cba7a56e80ea2c84c7cc275e4d26e0b6993af89a8352a',
  )
  const legacy = parsed.records.filter((record) => record.kind === 'legacy-unknown')
  expect(legacy).toHaveLength(3)
  expect(legacy.map((record) => record.batch)).toEqual(manifest.batches.slice(0, 3))
  expect(new Set(legacy.flatMap((record) => record.batch.sourceSha256)).size).toBe(300)
  expect(legacy.every((record) => record.eligible === false)).toBe(true)
})

test('partial exact hashes require reviewed coverage and retain unresolved-source refusal', () => {
  const { registration, inventory, manifest } = fixture()
  const exclusions = {
    ...registration.exclusions,
    complete: false,
    conservativeCoverage: { reviewEvidenceSha256: digest('review'), unresolvedSources: [] },
  }
  const record = { ...registration, exclusions, exclusionsSha256: digest(encoded(exclusions)) }
  expect(
    validateCustodyInventory({ ...inventory, records: [record] }, manifest).records[0],
  ).toMatchObject({ exclusions: { complete: false } })
  const unresolved = {
    ...exclusions,
    conservativeCoverage: {
      ...exclusions.conservativeCoverage,
      unresolvedSources: ['earlier-warmup-controls'],
    },
  }
  expect(() =>
    validateCustodyInventory(
      {
        ...inventory,
        records: [
          { ...record, exclusions: unresolved, exclusionsSha256: digest(encoded(unresolved)) },
        ],
      },
      manifest,
    ),
  ).toThrow()
  expect(() =>
    validateCustodyInventory(
      {
        ...inventory,
        records: [{ ...record, exclusions: { ...exclusions, conservativeCoverage: undefined } }],
      },
      manifest,
    ),
  ).toThrow()
  expect(() =>
    validateCustodyInventory(
      {
        ...inventory,
        records: [
          {
            ...registration,
            freeze: { ...registration.freeze, developmentPolicySha256: digest('changed policy') },
          },
        ],
      },
      manifest,
    ),
  ).toThrow()
})

test('downstream batch decoding verifies complete ordered sources and rejects policy overlap', async () => {
  const { readDisjointEvaluationBatch } = await import('./evaluation-custody')
  const root = await mkdtemp(path.join(tmpdir(), 'markdown-disjoint-control-'))
  temporary.add(root)
  const directory = path.join(root, 'packages/markdown/test/evaluation')
  await mkdir(directory, { recursive: true })
  const { registration } = fixture()
  const sources = Array.from({ length: 100 }, (_, index) => `Independent **source ${index}**.`)
  const record = { ...registration, batch: { ...registration.batch } }
  const writeBatch = async (values: readonly string[]) => {
    const payload = encoded(values.map((source) => ({ source })))
    const bytes = gzipSync(payload)
    record.batch = {
      ...record.batch,
      sourceSha256: values.map(digest),
      assetSha256: hash('sha256', bytes),
      uncompressedSha256: digest(payload),
    }
    await writeFile(path.join(directory, record.batch.file), bytes)
  }
  await writeBatch(sources)
  await expect(readDisjointEvaluationBatch(root, record)).resolves.toHaveLength(100)
  await expect(
    readDisjointEvaluationBatch(root, {
      ...record,
      batch: { ...record.batch, sourceSha256: record.batch.sourceSha256.toReversed() },
    }),
  ).rejects.toThrow()
  await expect(
    readDisjointEvaluationBatch(root, {
      ...record,
      batch: { ...record.batch, assetSha256: digest('changed') },
    }),
  ).rejects.toThrow()
  await expect(
    readDisjointEvaluationBatch(root, {
      ...record,
      batch: { ...record.batch, uncompressedSha256: digest('changed') },
    }),
  ).rejects.toThrow()
  await writeBatch(sources.slice(1))
  await expect(readDisjointEvaluationBatch(root, record)).rejects.toThrow()
  await writeBatch(['See [the log](unknown-runtime).'].concat(sources.slice(1)))
  await expect(readDisjointEvaluationBatch(root, record)).rejects.toThrow()
  await writeBatch(['development'].concat(sources.slice(1)))
  await expect(readDisjointEvaluationBatch(root, record)).rejects.toThrow()
})
