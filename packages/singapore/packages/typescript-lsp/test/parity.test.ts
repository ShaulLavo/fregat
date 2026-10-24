import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { InProcessTypeScriptWorker } from './inProcessWorker'
import {
  isRecord,
  runParityCases,
  uncoveredCapabilityPaths,
  unrunParityResults,
} from './parity/contract'
import { CORE_CASES } from './parity/cases/core'
import { CORE_PROJECT } from './parity/cases/project'
import { paritySourceIdentity } from './parity/source'
import { version as compilerVersion } from 'typescript-api'
import { createWorkerParityFixture } from './parity/worker'

describe('TypeScript in-process worker core parity', () => {
  const worker = new InProcessTypeScriptWorker()
  const fixture = createWorkerParityFixture({ worker })
  const terminate = vi.spyOn(worker, 'terminate')
  const source = paritySourceIdentity()
  const checks = { core: false, resultId: false, capabilities: false }
  const evidence = {
    kind: 'typescript-parity-run',
    backendId: 'worker-in-process',
    engine: 'worker',
    compilerVersion,
    transport: 'in-process',
    owned: true,
    source,
    sourceAfter: source,
    capabilities: fixture.session.capabilities,
    results: unrunParityResults(CORE_CASES, 'Worker initialization did not finish'),
    execution: { testPassed: false, cleanupVerified: false },
  }

  afterAll(() => {
    evidence.execution.testPassed = Object.values(checks).every(Boolean)
    evidence.capabilities = fixture.session.capabilities
    try {
      fixture.dispose()
      expect(terminate).toHaveBeenCalledOnce()
      expect(fixture.client.connected).toBe(false)
      expect(fixture.client.initialized).toBe(false)
      evidence.execution.cleanupVerified = true
    } finally {
      evidence.sourceAfter = paritySourceIdentity()
      terminate.mockRestore()
      process.stdout.write(JSON.stringify(evidence) + '\n')
    }
  })

  beforeAll(async () => {
    await fixture.initialize()
  }, 30_000)

  it('returns useful answers for every original method and required core outcome', async () => {
    const results = await runParityCases(fixture.session, CORE_CASES)
    evidence.results = results
    expect(results.filter((result) => result.status !== 'supported')).toEqual([])
    expect(results.map((result) => result.caseId)).toEqual(CORE_CASES.map((row) => row.id))
    checks.core = true
  }, 30_000)

  it('retains the worker-specific pull result identifier contract', async () => {
    const report = await fixture.client.request('textDocument/diagnostic', {
      textDocument: { uri: fixture.session.uri(CORE_PROJECT.mainPath) },
    })
    expect(isRecord(report) && typeof report.resultId === 'string').toBe(true)
    checks.resultId = true
  })

  it('covers every advertised method, including nested capabilities', () => {
    expect(uncoveredCapabilityPaths(fixture.session.capabilities, CORE_CASES)).toEqual([])
    checks.capabilities = true
  })
})
