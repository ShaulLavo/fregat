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
  readonly classification:
    | 'BYTE-EQUAL'
    | 'PINNED CLOCK TYPE-EXPORT ERASURE'
    | 'PINNED TREE-SHAKEN ANALYSIS CORRECTION'
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

export function bindX6AnalysisSource(file: string, frozen: string, current: string): SourceBinding {
  const frozenSha256 = hash('sha256', frozen, 'hex')
  const currentSha256 = hash('sha256', current, 'hex')
  if (frozen === current) return { file, frozenSha256, currentSha256, classification: 'BYTE-EQUAL' }
  assert(file.replaceAll('\\', '/').endsWith('/scripts/ghostty-x6-public-overlap.ts'))
  assert.equal(frozenSha256, frozenClock, 'Exact accepted overlap source required')
  assert.equal(currentSha256, '985f31415003181c51631d8ea2638a9ecd50269fb10878d9defa78c2302624c1')
  assert.equal(
    frozen
      .replace('export interface ClockMapping', 'interface ClockMapping')
      .replace(
        'assert(end >= start, `Runner job ${job.id} interval`)',
        'assert(end > start, `Runner job ${job.id} unresolved zero-width or reversed interval`)',
      ),
    current,
  )
  return {
    file,
    frozenSha256,
    currentSha256,
    classification: 'PINNED TREE-SHAKEN ANALYSIS CORRECTION',
  }
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
function verifyMaps(
  accepted: string,
  rebuilt: string,
  file: string,
  bind: typeof bindX6Source,
): void {
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
    const binding = bind(source, originalContents[index]!, currentContents[index]!)
    if (binding.classification !== 'BYTE-EQUAL') deltas++
  }
  assert.equal(deltas, 1, 'Exactly one qualified pinned overlap source delta is required')
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

function verifyArtifacts(accepted: string, rebuilt: string, bind: typeof bindX6Source) {
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
      verifyMaps(accepted, rebuilt, file, bind)
      continue
    }
    assert.equal(frozenSha256, rebuiltSha256, 'All executable, native and font bytes must match')
  }
  return { rebuiltArchive: rebuilt, artifacts, ledger: verifyLedger(accepted, rebuilt) }
}

export function verifyX6RuntimeReuse(accepted: string, evidenceFile: string) {
  const evidence: { acceptedArchive: string; postHookBuildArchive: string } = JSON.parse(
    readFileSync(evidenceFile, 'utf8'),
  )
  assert.equal(evidence.acceptedArchive, accepted)
  return {
    evidenceFile,
    evidenceSha256: hash('sha256', readFileSync(evidenceFile), 'hex'),
    ...verifyArtifacts(accepted, evidence.postHookBuildArchive, bindX6Source),
    qualification:
      '79 byte-equal map inputs and one pinned type-export erasure; all runtime bytes equal',
  }
}

export function verifyX6AnalysisReuse(accepted: string, footprintFile: string) {
  const bytes = readFileSync(footprintFile)
  const footprintSha256 = hash('sha256', bytes, 'hex')
  assert.equal(footprintSha256, 'c958fcd3a0ba05a882a2298172337702170d043ba0fa52c7b9c1547616ad1001')
  const footprint: {
    acceptedArchive: string
    correctedBuildArchive: string
    sourceHead: string
    artifacts: Readonly<Record<string, { frozenSha256: string; rebuiltSha256: string }>>
    ledger: { frozenRawSha256: string; rebuiltRawSha256: string }
  } = JSON.parse(bytes.toString('utf8'))
  assert.equal(footprint.acceptedArchive, accepted)
  assert.equal(footprint.sourceHead, 'b4dce0998d957668545c57a3195b3ccadc7417a4')
  const runtime = verifyArtifacts(accepted, footprint.correctedBuildArchive, bindX6AnalysisSource)
  const manifest: { sourceHead: string } = JSON.parse(
    readFileSync(join(runtime.rebuiltArchive, 'manifest.json'), 'utf8'),
  )
  assert.equal(manifest.sourceHead, footprint.sourceHead)
  assert.equal(runtime.ledger.frozenRawSha256, footprint.ledger.frozenRawSha256)
  assert.equal(runtime.ledger.rebuiltRawSha256, footprint.ledger.rebuiltRawSha256)
  assert.deepEqual(Object.keys(runtime.artifacts), Object.keys(footprint.artifacts))
  for (const [file, artifact] of Object.entries(runtime.artifacts)) {
    assert.equal(artifact.frozenSha256, footprint.artifacts[file]!.frozenSha256)
    assert.equal(artifact.rebuiltSha256, footprint.artifacts[file]!.rebuiltSha256)
  }
  for (const arm of ['instrumented', 'uninstrumented']) {
    const bundle = readFileSync(join(runtime.rebuiltArchive, arm, 'entry.mjs'), 'utf8')
    assert(bundle.includes('function epochNanoseconds('))
    assert(!bundle.includes('function jobInterval('))
    assert(!bundle.includes('unresolved zero-width or reversed interval'))
  }
  return {
    footprintFile,
    footprintSha256,
    correctedSourceHead: footprint.sourceHead,
    ...runtime,
    qualification:
      '79 byte-equal map inputs and one exact pinned tree-shaken analysis correction; all measured runtime bytes equal',
  }
}
