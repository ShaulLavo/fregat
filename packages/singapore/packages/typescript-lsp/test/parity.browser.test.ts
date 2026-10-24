import { expect, test, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { version as typescriptVersion } from 'typescript-api'
import { runParityCases, uncoveredCapabilityPaths, unrunParityResults } from './parity/contract'
import { CORE_CASES } from './parity/cases/core'
import { CORE_PROJECT } from './parity/cases/project'
import { createWorkerParityFixture } from './parity/worker'

type BrowserSourceIdentity = { revision: string; dirty: boolean; digest: string }

declare module 'vitest/browser' {
  interface BrowserCommands {
    typescriptParityBrowserRuntime(): Promise<{
      engine: string
      version: string
      workers: string[]
      source: BrowserSourceIdentity
    }>
  }
}

type WorkerCleanup = {
  terminated: number
  clientDisconnected: boolean
  remainingWorkers: string[]
}

test('real module worker returns useful answers for the shared TypeScript core contract', async (context) => {
  const runtime = await commands.typescriptParityBrowserRuntime()
  const worker = new Worker(new URL('../src/typescriptLsp.worker.ts', import.meta.url), {
    type: 'module',
  })
  const terminate = vi.spyOn(worker, 'terminate')
  const errors: string[] = []
  const onError = (event: ErrorEvent) => errors.push(event.message)
  worker.addEventListener('error', onError)
  const fixture = createWorkerParityFixture({ worker })
  const cleanup: WorkerCleanup = { terminated: 0, clientDisconnected: false, remainingWorkers: [] }
  const sources: {
    source: BrowserSourceIdentity
    sourceAfter: BrowserSourceIdentity | null
  } = { source: runtime.source, sourceAfter: null }
  const evidence = {
    kind: 'typescript-parity-run',
    backendId: `worker-${runtime.engine}`,
    engine: 'worker',
    transport: 'browser-module-worker',
    owned: true,
    ...sources,
    execution: { testPassed: false, cleanupVerified: false },
    project: CORE_PROJECT.id,
    compilerVersion: typescriptVersion,
    userAgent: navigator.userAgent,
    runtime,
    capabilities: fixture.session.capabilities,
    results: unrunParityResults(CORE_CASES, 'Worker initialization did not finish'),
    workerErrors: errors,
    cleanup,
  }
  Object.assign(context.task.meta, { typescriptParity: evidence })
  context.onTestFinished(async () => {
    evidence.capabilities = fixture.session.capabilities
    fixture.dispose()
    worker.removeEventListener('error', onError)
    evidence.cleanup.terminated = terminate.mock.calls.length
    evidence.cleanup.clientDisconnected = !fixture.client.connected && !fixture.client.initialized
    try {
      await observeWorkerCleanup(evidence.cleanup)
      expect(terminate).toHaveBeenCalledOnce()
      expect(fixture.client.connected).toBe(false)
      expect(fixture.client.initialized).toBe(false)
      evidence.execution.cleanupVerified = true
    } finally {
      terminate.mockRestore()
      await emitFinalCapture(evidence)
    }
  })

  await fixture.initialize()
  evidence.runtime = await commands.typescriptParityBrowserRuntime()
  evidence.capabilities = fixture.session.capabilities
  evidence.results = unrunParityResults(CORE_CASES, 'Core contract did not finish')
  evidence.results = await runParityCases(fixture.session, CORE_CASES)
  expect(evidence.runtime.workers.filter(isTypeScriptWorker)).toHaveLength(1)
  expect(evidence.results.filter((result) => result.status !== 'supported')).toEqual([])
  expect(evidence.results.map((result) => result.caseId)).toEqual(CORE_CASES.map((row) => row.id))
  expect(uncoveredCapabilityPaths(fixture.session.capabilities, CORE_CASES)).toEqual([])
  expect(errors).toEqual([])
  evidence.execution.testPassed = true
}, 60_000)

async function emitFinalCapture(evidence: {
  sourceAfter: BrowserSourceIdentity | null
}): Promise<void> {
  try {
    evidence.sourceAfter = (await commands.typescriptParityBrowserRuntime()).source
  } finally {
    console.info(JSON.stringify(evidence))
  }
}

async function observeWorkerCleanup(cleanup: WorkerCleanup): Promise<void> {
  await expect
    .poll(async () => {
      const runtime = await commands.typescriptParityBrowserRuntime()
      cleanup.remainingWorkers = runtime.workers.filter(isTypeScriptWorker)
      return cleanup.remainingWorkers
    })
    .toEqual([])
}

function isTypeScriptWorker(url: string): boolean {
  return new URL(url).pathname.endsWith('/typescriptLsp.worker.ts')
}

test('bundled TypeScript library declarations load as browser source text', async () => {
  const library = await import('typescript-api/lib/lib.es2023.full.d.ts?raw')
  expect(library.default).toContain('/// <reference lib=')
}, 10_000)
