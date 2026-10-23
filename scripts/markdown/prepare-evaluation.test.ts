import { hash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { EXCLUSION_GROUPS } from './evaluation-custody'
import { prepareEvaluation } from './prepare-evaluation'
import { encoded } from './serialization'
import { builtInExclusions } from './snapshot-evaluation'

test('preparation hashes unopened bytes, reports missing inputs, and validates final metadata', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'markdown-prepare-control-'))
  try {
    const directory = path.join(root, 'packages/markdown/test/evaluation')
    await mkdir(directory, { recursive: true })
    const asset = path.join(root, 'unopened.gz')
    const license = path.join(directory, 'LICENSE')
    const unopened = 'invalid gzip: source content must never be decoded by preparation'
    await writeFile(asset, unopened)
    await writeFile(license, 'synthetic-license')
    await writeFile(
      path.join(directory, 'manifest.json'),
      encoded({
        schemaVersion: 1,
        dataset: 'OpenAssistant/oasst1',
        revision: 'a'.repeat(40),
        license: 'Apache-2.0',
        asset: 'unopened.gz',
        assetSha256: hash('sha256', unopened),
        selection: 'Synthetic control',
        batches: [],
      }),
    )
    await writeFile(
      path.join(directory, 'custody.json'),
      encoded({ schemaVersion: 1, legacyManifestSha256: 'b'.repeat(64), records: [] }),
    )
    const input = { root, asset, license }
    const pending = await prepareEvaluation(input)
    expect(pending).toMatchObject({
      status: 'awaiting-inputs',
      selectionPerformed: false,
      eligibleMessages: null,
      requiredMessages: 100,
      missingInputs: ['final-parser-freeze', 'complete-development-exclusions'],
      quarantinedMessages: 0,
      source: { archiveBytes: Buffer.byteLength(unopened) },
    })
    expect(encoded(pending)).not.toContain(unopened)
    expect(await readFile(asset, 'utf8')).toBe(unopened)
    expect((await readdir(directory)).sort()).toEqual(['LICENSE', 'custody.json', 'manifest.json'])
    const exclusions = path.join(root, 'exclusions.json')
    const freeze = path.join(root, 'freeze.json')
    const time = '2026-01-01T00:00:00.000Z'
    const builtIn = await builtInExclusions()
    const metadata = {
      schemaVersion: 1,
      complete: true,
      recordedAt: time,
      groups: EXCLUSION_GROUPS.map((name) => ({
        name,
        sourceSha256: name === 'commonmark' ? Array.from(builtIn) : [],
      })),
    }
    await writeFile(exclusions, encoded(metadata))
    const frozen = {
      curator: 'synthetic-curator',
      custodyStartedAt: time,
      ledgerDirectory: path.join(root, 'ledger'),
      parserFreeze: {
        commit: 'a'.repeat(40),
        sourceSha256: 'c'.repeat(64),
        artifactsSha256: 'd'.repeat(64),
        frozenAt: time,
      },
    }
    await writeFile(freeze, encoded(frozen))
    await expect(prepareEvaluation({ ...input, exclusions, freeze })).resolves.toMatchObject({
      status: 'metadata-validated',
      selectionPerformed: false,
      eligibleMessages: null,
      missingInputs: [],
      exclusionsSha256: hash('sha256', encoded(metadata)),
      freeze: frozen,
    })
    await expect(prepareEvaluation({ ...input, freeze })).resolves.toMatchObject({
      status: 'awaiting-inputs',
      missingInputs: ['complete-development-exclusions'],
    })
    await writeFile(exclusions, encoded({ ...metadata, groups: [] }))
    await expect(prepareEvaluation({ ...input, exclusions, freeze })).rejects.toThrow()
    await writeFile(exclusions, encoded({ ...metadata, complete: false }))
    await expect(prepareEvaluation({ ...input, exclusions, freeze })).rejects.toThrow()
    await writeFile(exclusions, encoded(metadata))
    await writeFile(
      freeze,
      encoded({
        ...frozen,
        parserFreeze: { ...frozen.parserFreeze, frozenAt: '2999-01-01T00:00:00.000Z' },
      }),
    )
    await expect(prepareEvaluation({ ...input, exclusions, freeze })).rejects.toThrow()
    await writeFile(asset, unopened + 'changed')
    await expect(prepareEvaluation(input)).rejects.toThrow()
    await writeFile(asset, unopened)
    const otherLicense = path.join(root, 'other-license')
    await writeFile(otherLicense, 'changed license')
    await expect(prepareEvaluation({ ...input, license: otherLicense })).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
