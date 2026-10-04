import assert from 'node:assert/strict'
import { hash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const frozenClock = '470165420b429bb36ce056d2e8397af36e8003cf9b7586066278df80f24f3060'
const currentClock = '165bbcf94775aa62986b93488a6bc284a81e28c55aefba106bd58bf139a7ab50'

export interface SourceBinding {
  readonly file: string
  readonly frozenSha256: string
  readonly currentSha256: string
  readonly classification: 'BYTE-EQUAL' | 'PINNED CLOCK TYPE-EXPORT ERASURE'
}

export function bindX6Source(file: string, frozen: string, current: string): SourceBinding {
  const frozenSha256 = hash('sha256', frozen, 'hex')
  const currentSha256 = hash('sha256', current, 'hex')
  if (frozen === current) return { file, frozenSha256, currentSha256, classification: 'BYTE-EQUAL' }
  assert(file.replaceAll('\\', '/').endsWith('/scripts/ghostty-x6-public-overlap.ts'))
  assert.equal(frozenSha256, frozenClock, 'Only the pinned original clock source may differ')
  assert.equal(currentSha256, currentClock, 'Only the pinned current clock source may differ')
  assert.equal(frozen.replace('export interface ClockMapping', 'interface ClockMapping'), current)
  const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'node' })
  assert.equal(transpiler.transformSync(frozen), transpiler.transformSync(current))
  return { file, frozenSha256, currentSha256, classification: 'PINNED CLOCK TYPE-EXPORT ERASURE' }
}

interface SourceMap {
  readonly sources: readonly string[]
  readonly sourcesContent: readonly string[]
}
interface BuildManifest {
  readonly actualBase: string
  readonly sourceHashes: Readonly<Record<string, string>>
  readonly artifacts: Readonly<Record<string, string>>
}
function verifyMaps(accepted: string, rebuilt: string, file: string): void {
  const original: SourceMap = JSON.parse(readFileSync(join(accepted, file), 'utf8'))
  const current: SourceMap = JSON.parse(readFileSync(join(rebuilt, file), 'utf8'))
  const { sourcesContent: originalContents, ...originalFields } = original
  const { sourcesContent: currentContents, ...currentFields } = current
  assert.deepEqual(originalFields, currentFields, 'All other source-map fields must match')
  assert.equal(original.sources.length, 80)
  assert.equal(originalContents.length, original.sources.length)
  assert.equal(currentContents.length, original.sources.length)
  let deltas = 0
  for (let index = 0; index < original.sources.length; index++) {
    const source = resolve(dirname(join(accepted, file)), original.sources[index]!)
    const binding = bindX6Source(source, originalContents[index]!, currentContents[index]!)
    if (binding.classification !== 'BYTE-EQUAL') deltas++
  }
  assert.equal(deltas, 1, 'Exactly the qualified pinned type-export delta is required')
}

function verifyLedger(accepted: string, rebuilt: string) {
  const originalBytes = readFileSync(join(accepted, 'sites.json'))
  const currentBytes = readFileSync(join(rebuilt, 'sites.json'))
  const original: readonly { readonly id: string }[] = JSON.parse(originalBytes.toString('utf8'))
  const current: readonly { readonly id: string }[] = JSON.parse(currentBytes.toString('utf8'))
  const descriptors = new Map(original.map((site) => [site.id, site]))
  assert.equal(original.length, 4_902)
  assert.equal(descriptors.size, original.length, 'Original descriptor IDs must be unique')
  assert.equal(current.length, original.length)
  assert.equal(new Set(current.map((site) => site.id)).size, current.length)
  for (const site of current) assert.deepEqual(site, descriptors.get(site.id))
  return {
    frozenRawSha256: hash('sha256', originalBytes, 'hex'),
    rebuiltRawSha256: hash('sha256', currentBytes, 'hex'),
    descriptorCount: original.length,
    idIndexedDescriptorsEqual: true,
  }
}

export function verifyX6RuntimeReuse(accepted: string, evidenceFile: string) {
  const evidence: { acceptedArchive: string; postHookBuildArchive: string } = JSON.parse(
    readFileSync(evidenceFile, 'utf8'),
  )
  assert.equal(evidence.acceptedArchive, accepted)
  const rebuilt = evidence.postHookBuildArchive
  const original: BuildManifest = JSON.parse(readFileSync(join(accepted, 'manifest.json'), 'utf8'))
  const current: BuildManifest = JSON.parse(readFileSync(join(rebuilt, 'manifest.json'), 'utf8'))
  assert.equal(original.actualBase, current.actualBase)
  assert.deepEqual(original.sourceHashes, current.sourceHashes)
  assert.equal(Object.keys(original.sourceHashes).length, 69)
  assert.deepEqual(Object.keys(original.artifacts), Object.keys(current.artifacts))
  assert.equal(Object.keys(original.artifacts).length, 9)
  const artifacts: Record<string, { frozenSha256: string; rebuiltSha256: string }> = {}
  for (const [file, frozenSha256] of Object.entries(original.artifacts)) {
    const rebuiltSha256 = current.artifacts[file]!
    assert.equal(hash('sha256', readFileSync(join(accepted, file)), 'hex'), frozenSha256)
    assert.equal(hash('sha256', readFileSync(join(rebuilt, file)), 'hex'), rebuiltSha256)
    artifacts[file] = { frozenSha256, rebuiltSha256 }
    if (file.endsWith('.map')) {
      assert(file === 'instrumented/entry.mjs.map' || file === 'uninstrumented/entry.mjs.map')
      verifyMaps(accepted, rebuilt, file)
      continue
    }
    assert.equal(frozenSha256, rebuiltSha256, 'All executable, native and font bytes must match')
  }
  return {
    evidenceFile,
    evidenceSha256: hash('sha256', readFileSync(evidenceFile), 'hex'),
    rebuiltArchive: rebuilt,
    artifacts,
    ledger: verifyLedger(accepted, rebuilt),
    qualification:
      '79 byte-equal map inputs and one pinned type-export erasure; all runtime bytes equal',
  }
}
