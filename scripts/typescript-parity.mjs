import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import * as v from 'valibot'
import {
  capabilityAdvertised,
  uncoveredCapabilityPaths,
} from '../apps/server/test/fixtures/typescript-parity/contract.ts'
import { paritySourceIdentity } from '../apps/server/test/fixtures/typescript-parity/source.ts'
import { CORE_CASES } from '../apps/server/test/fixtures/typescript-parity/cases/core.ts'

export const REQUIRED_PARITY_BACKENDS = [
  { id: 'worker-in-process', engine: 'worker' },
  { id: 'worker-chromium', engine: 'worker' },
  { id: 'worker-firefox', engine: 'worker' },
  { id: 'worker-webkit', engine: 'worker' },
  { id: 'classic-tsserver', engine: 'classic' },
  { id: 'native-typescript', engine: 'native' },
  { id: 'external-typescript-websocket', engine: 'external' },
]

const nonempty = v.pipe(v.string(), v.minLength(1))
const resultSchema = v.object({
  caseId: nonempty,
  feature: nonempty,
  kind: v.picklist(['required', 'variant']),
  status: v.picklist(['supported', 'failed', 'unavailable', 'unrun']),
  reason: nonempty,
  capabilities: v.array(v.object({ path: nonempty, advertised: v.boolean() })),
})
const evidenceSchema = v.object({
  schemaVersion: v.literal(1),
  scope: v.literal('core-language-service'),
  source: v.object({
    revision: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/u)),
    dirty: v.boolean(),
    digest: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/u)),
  }),
  backends: v.pipe(
    v.array(
      v.object({
        id: nonempty,
        engine: v.picklist(['worker', 'classic', 'native', 'external']),
        compilerVersion: nonempty,
        transport: nonempty,
        owned: v.boolean(),
        execution: v.optional(v.object({ testPassed: v.boolean(), cleanupVerified: v.boolean() })),
        artifact: v.optional(
          v.object({
            path: nonempty,
            sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/u)),
          }),
        ),
        capabilities: v.nullable(v.record(v.string(), v.unknown())),
        results: v.array(resultSchema),
      }),
    ),
    v.minLength(1),
  ),
})

export function validateParityEvidence(input, mode = 'baseline') {
  if (mode !== 'baseline' && mode !== 'qualify') {
    return { ok: false, errors: ['Mode must be baseline or qualify'] }
  }
  const parsed = v.safeParse(evidenceSchema, input)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.issues.map(
        (issue) => `Invalid evidence at ${v.getDotPath(issue) ?? '<root>'}`,
      ),
    }
  }
  const evidence = parsed.output
  let errors = []
  const ids = evidence.backends.map((backend) => backend.id)
  if (new Set(ids).size !== ids.length) errors.push('Backend identities must be unique')
  for (const required of REQUIRED_PARITY_BACKENDS) {
    const backend = evidence.backends.find((item) => item.id === required.id)
    if (!backend || backend.engine !== required.engine) {
      errors.push(`Matrix requires backend role ${required.id} with its declared engine`)
    }
  }
  if (mode === 'qualify' && evidence.source.dirty)
    errors.push('Qualification requires a clean source revision')
  if (mode === 'qualify' && !evidence.backends.some((backend) => backend.owned)) {
    errors.push('Qualification requires an owned backend')
  }
  for (const [index, backend] of evidence.backends.entries()) {
    errors = errors.concat(validateBackend(backend, index, mode))
  }
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      scope: evidence.scope,
      mode,
      source: evidence.source,
      backends: evidence.backends.map(summarizeBackend),
      qualification:
        'Core language-service cases only; full editor feature qualification is separate',
    },
  }
}

function validateBackend(backend, index, mode) {
  let errors = []
  const prefix = `Backend ${index}`
  if (backend.results.some((result) => result.status !== 'unrun') && !backend.artifact) {
    errors.push(`${prefix}: executed cells require a run artifact`)
  }
  if (backend.results.some((result) => result.status !== 'unrun') && !backend.execution) {
    errors.push(`${prefix}: executed cells require a test and cleanup receipt`)
  }
  if (
    mode === 'qualify' &&
    qualificationTarget(backend) &&
    (!backend.execution?.testPassed || !backend.execution?.cleanupVerified)
  ) {
    errors.push(`${prefix}: qualification requires a passed test and verified cleanup`)
  }
  const canonical = new Map(CORE_CASES.map((row) => [row.id, row]))
  const ids = backend.results.map((result) => result.caseId)
  if (new Set(ids).size !== ids.length) errors.push(`${prefix}: duplicate case cells`)
  if (ids.length !== canonical.size || ids.some((id) => !canonical.has(id))) {
    errors.push(`${prefix}: cells must cover the complete canonical core contract`)
  }
  for (const result of backend.results) {
    const row = canonical.get(result.caseId)
    if (!row) continue
    errors = errors.concat(validateResult(backend, row, result, prefix, mode))
  }
  if (mode === 'qualify' && qualificationTarget(backend)) {
    const missing = uncoveredCapabilityPaths(backend.capabilities, CORE_CASES)
    if (missing.length > 0) errors.push(`${prefix}: advertised capabilities lack contract cases`)
  }
  return errors
}

function validateResult(backend, row, result, prefix, mode) {
  let errors = []
  if (result.feature !== row.feature || result.kind !== row.kind) {
    errors.push(`${prefix}: case metadata differs from the canonical contract`)
  }
  if (result.status !== 'unrun') {
    errors = errors.concat(validateObservations(backend, row, result, prefix))
  }
  const advertised = requirementAdvertised(row.capability, backend.capabilities)
  if (result.status === 'supported' && !advertised) {
    errors.push(`${prefix}: support cannot contradict absent required capabilities`)
  }
  if (result.status === 'unavailable' && advertised) {
    errors.push(`${prefix}: advertised capability cannot be classified unavailable`)
  }
  if (mode !== 'qualify' || !qualificationTarget(backend)) return errors
  if (result.status === 'unrun') errors.push(`${prefix}: qualification contains an unrun case`)
  const required = row.kind === 'required' || advertised
  if (required && result.status !== 'supported') {
    errors.push(`${prefix}: required outcome or negotiated variant is not supported`)
  }
  return errors
}

function validateObservations(backend, row, result, prefix) {
  const paths = row.capability.kind === 'always' ? [] : row.capability.paths
  const observed = new Map(result.capabilities.map((entry) => [entry.path, entry.advertised]))
  let errors = []
  if (observed.size !== result.capabilities.length || observed.size !== paths.length) {
    errors.push(`${prefix}: capability observations must match the canonical case`)
  }
  if (
    paths.some((path) => observed.get(path) !== capabilityAdvertised(backend.capabilities, path))
  ) {
    errors.push(`${prefix}: capability observations differ from the backend declaration`)
  }
  return errors
}

function requirementAdvertised(requirement, capabilities) {
  if (requirement.kind === 'always') return true
  const values = requirement.paths.map((path) => capabilityAdvertised(capabilities, path))
  if (values.length === 0) return false
  return requirement.kind === 'all' ? values.every(Boolean) : values.some(Boolean)
}

function qualificationTarget(backend) {
  return backend.owned || REQUIRED_PARITY_BACKENDS.some((required) => required.id === backend.id)
}

function summarizeBackend(backend) {
  const counts = { supported: 0, failed: 0, unavailable: 0, unrun: 0 }
  for (const result of backend.results) counts[result.status]++
  return {
    id: backend.id,
    engine: backend.engine,
    compilerVersion: backend.compilerVersion,
    transport: backend.transport,
    owned: backend.owned,
    counts,
    cases: backend.results.map((result) => ({
      caseId: result.caseId,
      status: result.status,
      reason: result.reason,
    })),
    uncoveredCapabilities: uncoveredCapabilityPaths(backend.capabilities, CORE_CASES),
  }
}

export async function parityCommand(args) {
  const [mode, path] = args
  if ((mode !== 'baseline' && mode !== 'qualify') || !path || args.length !== 2) {
    return {
      ok: false,
      errors: ['Usage: bun scripts/typescript-parity.mjs baseline|qualify <evidence.json>'],
    }
  }
  let input
  try {
    input = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return { ok: false, errors: ['Evidence file could not be read as JSON'] }
  }
  const result = validateParityEvidence(input, mode)
  if (!result.ok) return result
  const source = await actualSourceIdentity()
  if (!isDeepStrictEqual(input.source, source)) {
    return { ...result, ok: false, errors: ['Evidence source identity differs from this checkout'] }
  }
  const errors = await artifactErrors(input, dirname(resolve(path)))
  return { ...result, ok: errors.length === 0, errors }
}

async function actualSourceIdentity() {
  return paritySourceIdentity()
}

async function artifactErrors(evidence, directory) {
  const errors = []
  for (const [index, backend] of evidence.backends.entries()) {
    if (!backend.artifact) continue
    const error = await artifactError(backend, evidence.source, directory)
    if (error) errors.push(`Backend ${index}: ${error}`)
  }
  return errors
}

async function artifactError(backend, source, directory) {
  let bytes
  let artifact
  try {
    bytes = await readFile(resolve(directory, backend.artifact.path))
    artifact = JSON.parse(bytes.toString('utf8'))
  } catch {
    return 'Run artifact could not be read as JSON'
  }
  if (createHash('sha256').update(bytes).digest('hex') !== backend.artifact.sha256) {
    return 'Run artifact hash differs from recorded evidence'
  }
  if (!artifact || typeof artifact !== 'object') return 'Run artifact is not an evidence object'
  if (
    artifact.engine !== backend.engine ||
    artifact.compilerVersion !== backend.compilerVersion ||
    artifact.transport !== backend.transport ||
    artifact.owned !== backend.owned
  ) {
    return 'Run artifact backend metadata differs from the matrix'
  }
  if (
    artifact.kind !== 'typescript-parity-run' ||
    artifact.backendId !== backend.id ||
    !isDeepStrictEqual(artifact.source, source) ||
    !isDeepStrictEqual(artifact.sourceAfter, source)
  ) {
    return 'Run artifact backend/source identity differs from the matrix'
  }
  if (
    !isDeepStrictEqual(artifact.results, backend.results) ||
    !isDeepStrictEqual(artifact.capabilities, backend.capabilities) ||
    !isDeepStrictEqual(artifact.execution, backend.execution)
  ) {
    return 'Matrix cells or capabilities differ from the actual run artifact'
  }
  return null
}

if (import.meta.main) {
  const result = await parityCommand(process.argv.slice(2))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.ok) process.exitCode = 1
}
