import { hash } from 'node:crypto'
import { expect, test } from 'vitest'
import { selectEvaluationMessages } from './snapshot-evaluation'

const source = 'Human response with **strong** Markdown.\n'.repeat(6)
function message(id: string, overrides: Record<string, unknown> = {}) {
  return {
    message_id: id,
    text: source,
    role: 'assistant',
    lang: 'en',
    synthetic: false,
    deleted: false,
    created_date: '2023-04-01T00:00:00Z',
    ...overrides,
  }
}

test('sealed selection excludes development hashes, duplicate sources and synthetic/user/deleted rows', () => {
  const rows = [
    message('development'),
    message('duplicate'),
    message('synthetic', { text: source + 'synthetic', synthetic: true }),
    message('user', { text: source + 'user', role: 'prompter' }),
    message('deleted', { text: source + 'deleted', deleted: true }),
    message('human', { text: source + 'kept' }),
    message('repeated', { text: source + 'kept' }),
  ]
  const selected = selectEvaluationMessages(
    rows.map((row) => JSON.stringify(row)).join('\n'),
    new Set([hash('sha256', source, 'hex')]),
  )
  expect(selected).toHaveLength(1)
  expect(selected[0]?.id).toBe('repeated')
  expect(selected[0]?.sha256).toBe(hash('sha256', source + 'kept', 'hex'))
  expect(selected[0]?.provenance.license).toBe('Apache-2.0')
})

test('selection rejects an invalid external row and preserves authored Unicode/whitespace', () => {
  expect(() =>
    selectEvaluationMessages(JSON.stringify({ message_id: 'invalid' }), new Set()),
  ).toThrow()
  const unicode = source + '\n  שלום 👩🏽‍💻 é\r\n'
  const selected = selectEvaluationMessages(
    JSON.stringify(message('unicode', { text: unicode })),
    new Set(),
  )
  expect(selected[0]?.source).toBe(unicode)
})

test('seeded selection order is stable under dataset reorder', () => {
  const rows = Array.from({ length: 10 }, (_, index) =>
    message(String(index), { text: source + index }),
  )
  const encoded = (input: readonly Record<string, unknown>[]) =>
    input.map((row) => JSON.stringify(row)).join('\n')
  expect(selectEvaluationMessages(encoded(rows), new Set())).toEqual(
    selectEvaluationMessages(encoded(rows.toReversed()), new Set()),
  )
})

test('prospective curation writes a fresh whole batch and refuses capacity, pins and overwrite', async () => {
  const { lstat, mkdtemp, mkdir, readFile, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { gzipSync } = await import('node:zlib')
  const { curateEvaluationSnapshot } = await import('./snapshot-evaluation')
  const { EXCLUSION_GROUPS, requireEvaluationCustody } = await import('./evaluation-custody')
  const { encoded } = await import('./serialization')
  const root = await mkdtemp(path.join(tmpdir(), 'markdown-curation-control-'))
  try {
    const directory = path.join(root, 'packages/markdown/test/evaluation')
    await mkdir(directory, { recursive: true })
    await mkdir(path.join(root, 'scripts/markdown'), { recursive: true })
    const selector = await readFile(new URL('./snapshot-evaluation.ts', import.meta.url))
    await writeFile(path.join(root, 'scripts/markdown/snapshot-evaluation.ts'), selector)
    const raw = Array.from({ length: 201 }, (_, index) =>
      message(`fresh-${index}`, { text: source + index }),
    )
    const bytes = gzipSync(raw.map((row) => JSON.stringify(row)).join('\n'))
    const asset = path.join(root, 'source.gz')
    await writeFile(asset, bytes)
    const license = path.join(directory, 'LICENSE')
    await writeFile(license, 'synthetic license')
    const manifest = {
      schemaVersion: 1,
      dataset: 'OpenAssistant/oasst1',
      revision: 'fdf72ae0827c1cda404aff25b6603abec9e3399b',
      license: 'Apache-2.0',
      asset: 'synthetic.gz',
      assetSha256: hash('sha256', bytes),
      selection: 'Synthetic controls',
      batches: [],
    }
    const manifestFile = path.join(directory, 'manifest.json')
    const custodyFile = path.join(directory, 'custody.json')
    await writeFile(manifestFile, encoded(manifest))
    await writeFile(
      custodyFile,
      encoded({
        schemaVersion: 1,
        legacyManifestSha256: hash('sha256', 'synthetic legacy'),
        records: [],
      }),
    )
    const time = '2026-01-01T00:00:00.000Z'
    const excluded = hash('sha256', source + 0)
    const excludeManifest = path.join(root, 'exclusions.json')
    await writeFile(
      excludeManifest,
      encoded({
        schemaVersion: 1,
        complete: true,
        recordedAt: time,
        groups: EXCLUSION_GROUPS.map((name) => ({
          name,
          sourceSha256: [excluded],
        })),
      }),
    )
    const freezeManifest = path.join(root, 'freeze.json')
    const ledgerDirectory = path.join(root, 'exposures')
    await writeFile(
      freezeManifest,
      encoded({
        curator: 'synthetic-control',
        custodyStartedAt: time,
        ledgerDirectory,
        parserFreeze: {
          commit: 'a'.repeat(40),
          sourceSha256: hash('sha256', 'parser'),
          artifactsSha256: hash('sha256', 'artifacts'),
          frozenAt: time,
        },
      }),
    )
    const input = {
      asset,
      license,
      expectedAssetSha256: hash('sha256', bytes),
      expectedLicenseSha256: hash('sha256', 'synthetic license'),
      excludeManifest,
      freezeManifest,
      manifestFile,
      custodyFile,
      firstBatch: 4,
      batches: 2,
      out: path.join(root, 'selection'),
      builtInExcluded: new Set([excluded]),
      invocation: ['synthetic-control'],
    }
    await expect(curateEvaluationSnapshot({ ...input, batches: 3 })).rejects.toThrow()
    await expect(lstat(input.out)).rejects.toThrow()
    await expect(
      curateEvaluationSnapshot({
        ...input,
        expectedAssetSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow()
    await expect(
      curateEvaluationSnapshot({
        ...input,
        builtInExcluded: new Set([hash('sha256', 'missing')]),
      }),
    ).rejects.toThrow()
    await expect(
      curateEvaluationSnapshot({ ...input, expectedLicenseSha256: '0'.repeat(64) }),
    ).rejects.toThrow()
    const emptyOutput = path.join(root, 'existing-empty')
    await mkdir(emptyOutput)
    await expect(curateEvaluationSnapshot({ ...input, out: emptyOutput })).rejects.toThrow()
    await expect(curateEvaluationSnapshot(input)).resolves.toEqual({
      eligible: 200,
      sealedBatches: 2,
    })
    const output = JSON.parse(await readFile(path.join(input.out, 'manifest.json'), 'utf8'))
    expect(output.batches[0].sourceSha256).toHaveLength(100)
    expect(output.batches[1].sourceSha256).toHaveLength(100)
    expect(
      new Set(output.batches.flatMap((entry: { sourceSha256: string[] }) => entry.sourceSha256))
        .size,
    ).toBe(200)
    expect(output.batches[0].sourceSha256).not.toContain(excluded)
    expect(await readFile(path.join(input.out, 'previous-manifest.json'), 'utf8')).toBe(
      encoded(manifest),
    )
    const preserved = await readFile(path.join(input.out, 'manifest.json'), 'utf8')
    await expect(curateEvaluationSnapshot(input)).rejects.toThrow()
    expect(await readFile(path.join(input.out, 'manifest.json'), 'utf8')).toBe(preserved)
    await writeFile(manifestFile, await readFile(path.join(input.out, 'manifest.json')))
    await writeFile(custodyFile, await readFile(path.join(input.out, 'custody.json')))
    await expect(
      requireEvaluationCustody({
        root,
        batch: output.batches[0],
        ledgerDirectory,
        manifestSha256: hash('sha256', await readFile(manifestFile)),
        artifactsSha256: hash('sha256', 'artifacts'),
      }),
    ).resolves.toMatchObject({ kind: 'prospective-registration' })
    await expect(
      curateEvaluationSnapshot({
        ...input,
        out: path.join(root, 'next'),
        firstBatch: 6,
      }),
    ).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('duplicate attributable IDs cannot silently select different source bodies', () => {
  const raw = [message('same'), message('same', { text: source + 'changed' })]
  expect(() =>
    selectEvaluationMessages(raw.map((row) => JSON.stringify(row)).join('\n'), new Set()),
  ).toThrow()
})

test('malformed archive rows fail without echoing source bodies', () => {
  const body = 'SYNTHETIC_BODY_MUST_STAY_PRIVATE'
  try {
    selectEvaluationMessages(`{"text":"${body}`, new Set())
    expect.fail('Malformed source must refuse')
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain(body)
    expect(String(error)).toContain('A dataset row requires valid message metadata and text.')
  }
})

test('seeded selection keeps the same attribution when duplicate-source rows are reordered', () => {
  const rows = [message('duplicate-a'), message('duplicate-b')]
  const encoded = (input: readonly Record<string, unknown>[]) =>
    input.map((row) => JSON.stringify(row)).join('\n')
  const selected = selectEvaluationMessages(encoded(rows), new Set())
  expect(selected).toHaveLength(1)
  expect(selectEvaluationMessages(encoded(rows.toReversed()), new Set())).toEqual(selected)
})
