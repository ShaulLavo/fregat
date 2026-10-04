import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  bindX6Source,
  bindX6AnalysisSource,
  verifyX6RuntimeReuse,
  verifyX6AnalysisReuse,
} from './ghostty-x6-public-reuse.ts'

const corrected = readFileSync(new URL('./ghostty-x6-public-overlap.ts', import.meta.url), 'utf8')
// Reconstruct the exact historical fixture; corrected runtime source must fail the old exception.
const current = corrected.replace(
  'assert(end > start, `Runner job ${job.id} unresolved zero-width or reversed interval`)',
  'assert(end >= start, `Runner job ${job.id} interval`)',
)
const frozen = current.replace('interface ClockMapping', 'export interface ClockMapping')

test('binds byte identity separately from the exact pinned type-export deletion', () => {
  expect(bindX6Source('/checkout/other.ts', 'const a = 1', 'const a = 1').classification).toBe(
    'BYTE-EQUAL',
  )
  expect(
    bindX6Source('/checkout/scripts/ghostty-x6-public-overlap.ts', frozen, current),
  ).toMatchObject({
    classification: 'PINNED CLOCK TYPE-EXPORT ERASURE',
    frozenSha256: '470165420b429bb36ce056d2e8397af36e8003cf9b7586066278df80f24f3060',
    currentSha256: '165bbcf94775aa62986b93488a6bc284a81e28c55aefba106bd58bf139a7ab50',
  })
})

test('rejects other files, other type erasures and any additional source delta', () => {
  expect(() => bindX6Source('/checkout/other.ts', frozen, current)).toThrow()
  expect(() =>
    bindX6Source('/checkout/scripts/ghostty-x6-public-overlap.ts', frozen, corrected),
  ).toThrow()
  expect(() =>
    bindX6Source('/checkout/scripts/ghostty-x6-public-overlap.ts', frozen, current + '\n'),
  ).toThrow()
  expect(() =>
    bindX6Source(
      '/checkout/scripts/ghostty-x6-public-overlap.ts',
      'export interface Other {}',
      'interface Other {}',
    ),
  ).toThrow()
})

test('binds only the separately pinned tree-shaken analysis correction', () => {
  expect(
    bindX6AnalysisSource('/checkout/scripts/ghostty-x6-public-overlap.ts', frozen, corrected),
  ).toMatchObject({
    classification: 'PINNED TREE-SHAKEN ANALYSIS CORRECTION',
    frozenSha256: '470165420b429bb36ce056d2e8397af36e8003cf9b7586066278df80f24f3060',
    currentSha256: '985f31415003181c51631d8ea2638a9ecd50269fb10878d9defa78c2302624c1',
  })
  expect(bindX6AnalysisSource('/checkout/other.ts', 'same', 'same').classification).toBe(
    'BYTE-EQUAL',
  )
  expect(() => bindX6AnalysisSource('/checkout/other.ts', frozen, corrected)).toThrow()
  expect(() =>
    bindX6AnalysisSource('/checkout/scripts/ghostty-x6-public-overlap.ts', frozen, current),
  ).toThrow()
  expect(() =>
    bindX6AnalysisSource(
      '/checkout/scripts/ghostty-x6-public-overlap.ts',
      frozen,
      corrected + '\n',
    ),
  ).toThrow()
  expect(() =>
    bindX6AnalysisSource(
      '/checkout/scripts/ghostty-x6-public-overlap.ts',
      frozen,
      corrected.replace('end > start', 'end >= start'),
    ),
  ).toThrow()
})

test('requires the actual fixed build footprint rather than an invented qualification', () => {
  fixture((accepted, _rebuilt, evidence) => {
    expect(() => verifyX6AnalysisReuse(accepted, evidence)).toThrow()
  })
})

function fixture(run: (accepted: string, rebuilt: string, evidence: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'x6-reuse-'))
  try {
    const accepted = join(directory, 'accepted')
    const rebuilt = join(directory, 'rebuilt')
    for (const root of [accepted, rebuilt]) {
      mkdirSync(join(root, 'instrumented'), { recursive: true })
      mkdirSync(join(root, 'uninstrumented'))
      const artifacts: Record<string, string> = {}
      for (const arm of ['instrumented', 'uninstrumented']) {
        const sources = Array.from({ length: 80 }, (_, index) => `input-${index}.ts`)
        sources[0] = '../../scripts/ghostty-x6-public-overlap.ts'
        const contents = sources.map(() => 'const a = 1')
        contents[0] = root === accepted ? frozen : current
        writeFileSync(
          join(root, arm, 'entry.mjs.map'),
          JSON.stringify({ version: 3, sources, sourcesContent: contents, mappings: '' }),
        )
        for (const file of ['entry.mjs', 'ghostty-vt.wasm', 'bridge.wasm'])
          writeFileSync(join(root, arm, file), 'fixed-byte-fixture')
        for (const file of ['entry.mjs', 'entry.mjs.map', 'ghostty-vt.wasm', 'bridge.wasm']) {
          const name = `${arm}/${file}`
          artifacts[name] = hash('sha256', readFileSync(join(root, name)), 'hex')
        }
      }
      writeFileSync(join(root, 'fixture-font.ttf'), 'fixed-font-fixture')
      artifacts['fixture-font.ttf'] = hash(
        'sha256',
        readFileSync(join(root, 'fixture-font.ttf')),
        'hex',
      )
      const sourceHashes = Object.fromEntries(
        Array.from({ length: 69 }, (_, index) => [`source-${index}`, 'fixture']),
      )
      writeFileSync(
        join(root, 'manifest.json'),
        JSON.stringify({ actualBase: 'fixed-product', sourceHashes, artifacts }),
      )
      const sites = Array.from({ length: 4_902 }, (_, index) => ({
        id: `site-${index}`,
        text: 'fixture',
      }))
      if (root === rebuilt) sites.reverse()
      writeFileSync(join(root, 'sites.json'), JSON.stringify(sites))
    }
    const evidence = join(directory, 'evidence.json')
    writeFileSync(
      evidence,
      JSON.stringify({ acceptedArchive: accepted, postHookBuildArchive: rebuilt }),
    )
    run(accepted, rebuilt, evidence)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function rehash(root: string, file: string): void {
  const manifestFile = join(root, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  manifest.artifacts[file] = hash('sha256', readFileSync(join(root, file)), 'hex')
  writeFileSync(manifestFile, JSON.stringify(manifest))
}

test('qualifies all runtime artifacts and both structurally bound maps', () => {
  fixture((accepted, _rebuilt, evidence) => {
    expect(verifyX6RuntimeReuse(accepted, evidence).qualification).toContain('79 byte-equal')
  })
})

test('binds ledger raw hashes and rejects altered descriptors or duplicate IDs', () => {
  fixture((accepted, rebuilt, evidence) => {
    const ledger = verifyX6RuntimeReuse(accepted, evidence).ledger
    expect(ledger.frozenRawSha256).not.toBe(ledger.rebuiltRawSha256)
    const file = join(rebuilt, 'sites.json')
    const sites = JSON.parse(readFileSync(file, 'utf8'))
    sites[0].text = 'changed descriptor'
    writeFileSync(file, JSON.stringify(sites))
    expect(() => verifyX6RuntimeReuse(accepted, evidence)).toThrow()
    sites[0].text = 'fixture'
    sites[0].id = sites[1].id
    writeFileSync(file, JSON.stringify(sites))
    expect(() => verifyX6RuntimeReuse(accepted, evidence)).toThrow()
  })
})

test('rejects runtime differences even when manifest hashes are updated', () => {
  fixture((accepted, rebuilt, evidence) => {
    writeFileSync(join(rebuilt, 'uninstrumented/entry.mjs'), 'different runtime')
    rehash(rebuilt, 'uninstrumented/entry.mjs')
    expect(() => verifyX6RuntimeReuse(accepted, evidence)).toThrow()
  })
})

test('rejects changed map structure or another mapped source even with updated hashes', () => {
  fixture((accepted, rebuilt, evidence) => {
    const file = 'instrumented/entry.mjs.map'
    const map = JSON.parse(readFileSync(join(rebuilt, file), 'utf8'))
    map.mappings = 'AAAA'
    writeFileSync(join(rebuilt, file), JSON.stringify(map))
    rehash(rebuilt, file)
    expect(() => verifyX6RuntimeReuse(accepted, evidence)).toThrow()
    map.mappings = ''
    map.sourcesContent[1] = 'const a = 2'
    writeFileSync(join(rebuilt, file), JSON.stringify(map))
    rehash(rebuilt, file)
    expect(() => verifyX6RuntimeReuse(accepted, evidence)).toThrow()
  })
})
