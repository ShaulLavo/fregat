import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CORE_CASES } from '../apps/server/test/fixtures/typescript-parity/cases/core'
import { capabilityAdvertised } from '../apps/server/test/fixtures/typescript-parity/contract'
import { paritySourceIdentity } from '../apps/server/test/fixtures/typescript-parity/source'
import {
  REQUIRED_PARITY_BACKENDS,
  parityCommand,
  validateParityEvidence,
} from './typescript-parity.mjs'
import {
  assembleParityEvidence,
  captureParityCommand,
  parityRunsFromLog,
} from './typescript-parity-capture.mjs'

const directories = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function evidence() {
  const capabilities = {}
  for (const row of CORE_CASES) {
    if (row.capability.kind === 'always') continue
    for (const path of row.capability.paths) advertise(capabilities, path)
  }
  return {
    schemaVersion: 1,
    scope: 'core-language-service',
    source: { revision: 'a'.repeat(40), dirty: false, digest: 'b'.repeat(64) },
    backends: REQUIRED_PARITY_BACKENDS.map((backend) => ({
      id: backend.id,
      engine: backend.engine,
      compilerVersion: '6.0.3',
      transport: 'fixture',
      owned: true,
      execution: { testPassed: true, cleanupVerified: true },
      artifact: { path: `${backend.id}.json`, sha256: '0'.repeat(64) },
      capabilities: structuredClone(capabilities),
      results: CORE_CASES.map((row) => ({
        caseId: row.id,
        feature: row.feature,
        kind: row.kind,
        status: 'supported',
        reason: row.expectation,
        capabilities: (row.capability.kind === 'always' ? [] : row.capability.paths).map(
          (path) => ({
            path,
            advertised: capabilityAdvertised(capabilities, path),
          }),
        ),
      })),
    })),
  }
}

function advertise(root, path) {
  const parts = path.split('.')
  let value = root
  for (const part of parts.slice(0, -1)) {
    const child = value[part]
    if (isRecord(child)) {
      value = child
      continue
    }
    const next = {}
    value[part] = next
    value = next
  }
  const last = parts.at(-1)
  if (last && !isRecord(value[last])) value[last] = true
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('TypeScript core parity evidence boundary', () => {
  it('accepts complete supported core evidence and states its qualification scope', () => {
    const result = validateParityEvidence(evidence(), 'qualify')
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.summary?.qualification).toContain('Core language-service cases only')
  })

  it('requires every planned backend role even when the worker is green', () => {
    const input = evidence()
    input.backends.splice(1)
    expect(validateParityEvidence(input, 'baseline').ok).toBe(false)
    expect(validateParityEvidence(input, 'qualify').ok).toBe(false)
  })

  it('requires evidence references for executed cells', () => {
    const input = evidence()
    const backend = input.backends[0]
    if (!backend) expect.unreachable('Fixture has a backend')
    const { artifact: _artifact, ...withoutArtifact } = backend
    const invalid = { ...input, backends: [withoutArtifact].concat(input.backends.slice(1)) }
    expect(validateParityEvidence(invalid).ok).toBe(false)
  })

  it('records known failures in a baseline but rejects them for qualification', () => {
    const input = evidence()
    const cell = input.backends[0]?.results[0]
    expect(cell).toBeDefined()
    if (!cell) return
    cell.status = 'failed'
    cell.reason = 'A real handler returned an unusable answer'
    expect(validateParityEvidence(input, 'baseline').ok).toBe(true)
    expect(validateParityEvidence(input, 'qualify').ok).toBe(false)
  })

  it('rejects missing and duplicate cells instead of qualifying a smaller contract', () => {
    const missing = evidence()
    missing.backends[0]?.results.pop()
    expect(validateParityEvidence(missing).ok).toBe(false)
    const duplicate = evidence()
    const cells = duplicate.backends[0]?.results
    const first = cells?.[0]
    if (!cells || !first) expect.unreachable('Fixture has case cells')
    cells.push(first)
    expect(validateParityEvidence(duplicate).ok).toBe(false)
  })

  it('rejects case metadata that disguises a mandatory result as conditional', () => {
    const input = evidence()
    const cell = input.backends[0]?.results.find((item) => item.kind === 'required')
    if (!cell) expect.unreachable('Fixture has required cases')
    cell.kind = 'variant'
    expect(validateParityEvidence(input).ok).toBe(false)
  })

  it('checks nested capability observations against the actual declaration', () => {
    const input = evidence()
    const cell = input.backends[0]?.results.find((item) => item.caseId === 'completionItem/resolve')
    const observation = cell?.capabilities[0]
    if (!observation) expect.unreachable('Fixture has completion resolution')
    observation.advertised = false
    expect(validateParityEvidence(input).ok).toBe(false)
  })

  it('allows an unadvertised wire variant while keeping required outcomes mandatory', () => {
    const input = evidence()
    const backend = input.backends[0]
    if (!backend) expect.unreachable('Fixture has a backend')
    const provider = backend.capabilities.completionProvider
    if (!isRecord(provider)) expect.unreachable('Fixture has completion provider options')
    provider.resolveProvider = false
    const cell = backend.results.find((item) => item.caseId === 'completionItem/resolve')
    if (!cell) expect.unreachable('Fixture has completion resolution')
    cell.status = 'unavailable'
    cell.reason = 'Resolve is not advertised; eager detail supplies the user outcome'
    cell.capabilities = [{ path: 'completionProvider.resolveProvider', advertised: false }]
    expect(validateParityEvidence(input, 'qualify').ok).toBe(true)
    const required = backend.results.find((item) => item.caseId === 'completion-detail')
    if (!required) expect.unreachable('Fixture has completion detail')
    required.status = 'failed'
    expect(validateParityEvidence(input, 'qualify').ok).toBe(false)
  })

  it('rejects advertised nested variants without executable cases', () => {
    const input = evidence()
    const backend = input.backends[0]
    if (!backend) expect.unreachable('Fixture has a backend')
    advertise(backend.capabilities, 'semanticTokensProvider.full.delta')
    expect(validateParityEvidence(input, 'baseline').ok).toBe(true)
    expect(validateParityEvidence(input, 'qualify').ok).toBe(false)
  })

  it('keeps explicit unrun results and dirty source out of qualification', () => {
    const input = evidence()
    const cell = input.backends[0]?.results[0]
    if (!cell) expect.unreachable('Fixture has case cells')
    cell.status = 'unrun'
    cell.reason = 'Browser execution has not run'
    cell.capabilities = []
    expect(validateParityEvidence(input, 'baseline').ok).toBe(true)
    expect(validateParityEvidence(input, 'qualify').ok).toBe(false)
    const dirty = evidence()
    dirty.source.dirty = true
    expect(validateParityEvidence(dirty, 'qualify').ok).toBe(false)
  })

  it('rejects invalid schemas, modes, versions and empty matrices', () => {
    expect(validateParityEvidence(null).ok).toBe(false)
    expect(validateParityEvidence(evidence(), 'invented').ok).toBe(false)
    const version = evidence()
    version.schemaVersion = 2
    expect(validateParityEvidence(version).ok).toBe(false)
    const empty = evidence()
    empty.backends = []
    expect(validateParityEvidence(empty).ok).toBe(false)
  })
})

function runs(source = paritySourceIdentity()) {
  return evidence().backends.map((backend) => ({
    kind: 'typescript-parity-run',
    backendId: backend.id,
    engine: backend.engine,
    compilerVersion: backend.compilerVersion,
    transport: backend.transport,
    owned: backend.owned,
    execution: backend.execution,
    capabilities: backend.capabilities,
    results: backend.results,
    source,
    sourceAfter: source,
  }))
}

async function captureFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'typescript-parity-evidence-'))
  directories.push(directory)
  const log = join(directory, 'run.log')
  const path = join(directory, 'evidence.json')
  await writeFile(
    log,
    runs()
      .map((run) => JSON.stringify(run))
      .join('\n'),
  )
  expect((await captureParityCommand([path, log])).ok).toBe(true)
  return { directory, path }
}

describe('source-bound TypeScript parity capture', () => {
  it('fingerprints a deleted tracked source file as dirty source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'typescript-parity-source-'))
    directories.push(directory)
    const path = join(directory, 'apps/server/test/fixtures/typescript-parity/fixture.ts')
    await mkdir(join(directory, 'apps/server/test/fixtures/typescript-parity'), {
      recursive: true,
    })
    await writeFile(path, 'export const fixture = 1\n')
    execFileSync('git', ['init', '--quiet'], { cwd: directory })
    execFileSync('git', ['add', '.'], { cwd: directory })
    execFileSync(
      'git',
      [
        '-c',
        `core.hooksPath=${join(directory, 'empty-hooks')}`,
        '-c',
        'commit.gpgSign=false',
        '-c',
        'user.name=Parity fixture',
        '-c',
        'user.email=parity@example.test',
        'commit',
        '--quiet',
        '-m',
        'Fixture',
      ],
      { cwd: directory },
    )
    const before = paritySourceIdentity(directory)
    expect(before.dirty).toBe(false)
    await rm(path)
    const after = paritySourceIdentity(directory)
    expect(after.dirty).toBe(true)
    expect(after.revision).toBe(before.revision)
    expect(after.digest).not.toBe(before.digest)
  })

  it('retains failed runs and makes missing roles explicitly unrun', () => {
    const input = runs()
    const run = input[0]
    if (!run) expect.unreachable('Fixture has a run')
    const cell = run.results[0]
    if (!cell) expect.unreachable('Fixture has a case')
    cell.status = 'failed'
    const result = assembleParityEvidence([run], run.source)
    expect(result.ok).toBe(true)
    expect(result.evidence.backends[0].results[0].status).toBe('failed')
    expect(result.evidence.backends[1].results.every((item) => item.status === 'unrun')).toBe(true)
    expect(validateParityEvidence(result.evidence, 'qualify').ok).toBe(false)
  })

  it('rejects duplicate retries, unknown identities and stale source snapshots', () => {
    const input = runs()
    const first = input[0]
    if (!first) expect.unreachable('Fixture has a run')
    expect(assembleParityEvidence(input.concat([first]), first.source).ok).toBe(false)
    expect(assembleParityEvidence([{ ...first, backendId: 'invented' }], first.source).ok).toBe(
      false,
    )
    expect(assembleParityEvidence(input, { ...first.source, digest: 'f'.repeat(64) }).ok).toBe(
      false,
    )
  })

  it('fails malformed tagged JSON while ignoring unrelated log lines', () => {
    expect(parityRunsFromLog('worker started\n{"kind":"typescript-parity-run"').ok).toBe(false)
    expect(parityRunsFromLog('worker started\n{"other":"event"}\n').runs).toEqual([])
  })

  it('keeps failed tests or teardown out of qualification even with supported cells', () => {
    const input = evidence()
    input.backends[0].execution.cleanupVerified = false
    expect(validateParityEvidence(input, 'baseline').ok).toBe(true)
    expect(validateParityEvidence(input, 'qualify').ok).toBe(false)
    input.backends[0].execution.cleanupVerified = true
    input.backends[0].execution.testPassed = false
    expect(validateParityEvidence(input, 'qualify').ok).toBe(false)
  })

  it('rejects source changes during execution', () => {
    const input = runs()
    input[0].sourceAfter = { ...input[0].source, digest: 'f'.repeat(64) }
    expect(assembleParityEvidence(input, input[0].source).ok).toBe(false)
  })

  it('captures real files and checks their hashes and checkout source', async () => {
    const fixture = await captureFixture()
    const result = await parityCommand(['baseline', fixture.path])
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    const manifest = JSON.parse(await readFile(fixture.path, 'utf8'))
    manifest.source.revision = 'f'.repeat(40)
    await writeFile(fixture.path, JSON.stringify(manifest))
    expect((await parityCommand(['baseline', fixture.path])).errors).toContain(
      'Evidence source identity differs from this checkout',
    )
  })

  it.each(['engine', 'compilerVersion', 'transport', 'owned'])(
    'binds %s metadata to the run artifact',
    async (field) => {
      const fixture = await captureFixture()
      const manifest = JSON.parse(await readFile(fixture.path, 'utf8'))
      const backend = manifest.backends[0]
      const artifactPath = join(fixture.directory, backend.artifact.path)
      const artifact = JSON.parse(await readFile(artifactPath, 'utf8'))
      artifact[field] = field === 'owned' ? false : 'forged'
      const bytes = JSON.stringify(artifact)
      await writeFile(artifactPath, bytes)
      backend.artifact.sha256 = createHash('sha256').update(bytes).digest('hex')
      await writeFile(fixture.path, JSON.stringify(manifest))
      expect((await parityCommand(['baseline', fixture.path])).errors).toContain(
        'Backend 0: Run artifact backend metadata differs from the matrix',
      )
    },
  )

  it('rejects missing artifacts and tampering with artifact bytes or matrix cells', async () => {
    const fixture = await captureFixture()
    const manifest = JSON.parse(await readFile(fixture.path, 'utf8'))
    const backend = manifest.backends[0]
    const artifactPath = join(fixture.directory, backend.artifact.path)
    const original = await readFile(artifactPath, 'utf8')
    await writeFile(artifactPath, original + ' ')
    expect((await parityCommand(['baseline', fixture.path])).errors).toContain(
      'Backend 0: Run artifact hash differs from recorded evidence',
    )
    await writeFile(artifactPath, original)
    backend.results[0].reason = 'Forged result'
    await writeFile(fixture.path, JSON.stringify(manifest))
    expect((await parityCommand(['baseline', fixture.path])).errors).toContain(
      'Backend 0: Matrix cells or capabilities differ from the actual run artifact',
    )
    await rm(artifactPath)
    expect((await parityCommand(['baseline', fixture.path])).errors).toContain(
      'Backend 0: Run artifact could not be read as JSON',
    )
  })
})
