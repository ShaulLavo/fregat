import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { CORE_CASES } from '../packages/singapore/packages/typescript-lsp/test/parity/cases/core.ts'
import { unrunParityResults } from '../packages/singapore/packages/typescript-lsp/test/parity/contract.ts'
import { paritySourceIdentity } from '../packages/singapore/packages/typescript-lsp/test/parity/source.ts'
import { REQUIRED_PARITY_BACKENDS, validateParityEvidence } from './typescript-parity.mjs'

export function parityRunsFromLog(log) {
  const runs = []
  for (const line of log.split('\n')) {
    if (!line.includes('"kind":"typescript-parity-run"')) continue
    try {
      const run = JSON.parse(line.slice(line.indexOf('{')))
      if (run.kind !== 'typescript-parity-run') return { ok: false, errors: ['Invalid run tag'] }
      runs.push(run)
    } catch {
      return { ok: false, errors: ['Tagged run line could not be read as JSON'] }
    }
  }
  return { ok: true, runs }
}

export function assembleParityEvidence(runs, source) {
  const ids = runs.map((run) => run.backendId)
  if (new Set(ids).size !== ids.length) {
    return { ok: false, errors: ['Duplicate backend runs require an explicit separate capture'] }
  }
  const roles = new Set(REQUIRED_PARITY_BACKENDS.map((backend) => backend.id))
  if (ids.some((id) => !roles.has(id))) return { ok: false, errors: ['Unknown backend run'] }
  if (
    runs.some(
      (run) =>
        !isDeepStrictEqual(run.source, source) || !isDeepStrictEqual(run.sourceAfter, source),
    )
  ) {
    return { ok: false, errors: ['Run source identity differs from the capture checkout'] }
  }
  const artifacts = []
  const backends = REQUIRED_PARITY_BACKENDS.map((role) => {
    const run = runs.find((item) => item.backendId === role.id)
    if (!run) return unrunBackend(role)
    const bytes = JSON.stringify(run, null, 2) + '\n'
    const path = `runs/${role.id}.json`
    artifacts.push({ path, bytes })
    return {
      id: role.id,
      engine: run.engine,
      compilerVersion: run.compilerVersion,
      transport: run.transport,
      owned: run.owned,
      execution: run.execution,
      capabilities: run.capabilities,
      results: run.results,
      artifact: { path, sha256: createHash('sha256').update(bytes).digest('hex') },
    }
  })
  const evidence = { schemaVersion: 1, scope: 'core-language-service', source, backends }
  const validation = validateParityEvidence(evidence)
  if (!validation.ok) return validation
  return { ok: true, evidence, artifacts }
}

function unrunBackend(role) {
  return {
    ...role,
    compilerVersion: 'unrun',
    transport: 'unrun',
    owned: role.engine !== 'external',
    capabilities: null,
    results: unrunParityResults(CORE_CASES, 'No run artifact was supplied for this backend'),
  }
}

export async function captureParityCommand(args) {
  const [path, ...logs] = args
  if (!path || logs.length === 0) {
    return {
      ok: false,
      errors: ['Usage: bun scripts/typescript-parity-capture.mjs <evidence.json> <run.log>…'],
    }
  }
  let runs = []
  for (const logPath of logs) {
    let log
    try {
      log = await readFile(logPath, 'utf8')
    } catch {
      return { ok: false, errors: ['Run log could not be read'] }
    }
    const parsed = parityRunsFromLog(log)
    if (!parsed.ok) return parsed
    runs = runs.concat(parsed.runs)
  }
  if (runs.length === 0) return { ok: false, errors: ['No tagged run artifacts were supplied'] }
  const assembled = assembleParityEvidence(runs, paritySourceIdentity())
  if (!assembled.ok) return assembled
  const directory = dirname(resolve(path))
  await mkdir(resolve(directory, 'runs'), { recursive: true })
  for (const artifact of assembled.artifacts) {
    await writeFile(resolve(directory, artifact.path), artifact.bytes)
  }
  await writeFile(path, JSON.stringify(assembled.evidence, null, 2) + '\n')
  return { ok: true, path, source: assembled.evidence.source }
}

if (import.meta.main) {
  const result = await captureParityCommand(process.argv.slice(2))
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (!result.ok) process.exitCode = 1
}
