import { access } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isRecord,
  runParityCases,
  uncoveredCapabilityPaths,
  unrunParityResults,
  type ParityCaseResult,
  type ParityDiagnostic,
} from '../../../test/fixtures/typescript-parity/contract'
import { CORE_CASES } from '../../../test/fixtures/typescript-parity/cases/core'
import { CORE_PROJECT, positionOf } from '../../../test/fixtures/typescript-parity/cases/project'
import { paritySourceIdentity } from '../../../test/fixtures/typescript-parity/source'
import {
  createTypeScriptParityFixture,
  TYPESCRIPT_PARITY_RUNTIMES,
  waitForCorePublishedDiagnostics,
} from '../../../test/factories/typescript-parity'
import { typescriptRuntimeFixture } from '../../../test/factories/typescript-runtime'

type ParityFixture = Awaited<ReturnType<typeof createTypeScriptParityFixture>>
type ParityRun = {
  readonly fixture: ParityFixture
  readonly source: ReturnType<typeof paritySourceIdentity>
  capabilities: ParityFixture['session']['capabilities']
  serverInfo: NonNullable<ParityFixture['client']['initializeResult']>['serverInfo'] | null
  results: readonly ParityCaseResult[]
  readonly execution: { testPassed: boolean; cleanupVerified: boolean }
}

const runs: ParityRun[] = []
const BASELINE_GAPS = {
  'typescript-classic': {
    failed: ['codeAction/resolve', 'extract-refactor'],
    unavailable: ['textDocument/onTypeFormatting', 'textDocument/diagnostic'],
  },
  'typescript-native': {
    failed: ['textDocument/codeAction', 'extract-refactor'],
    unavailable: ['codeAction/resolve'],
  },
}

afterEach(async () => {
  const settled = await Promise.allSettled(runs.splice(0).map(finishRun))
  const failed = settled.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
})

describe('shared TypeScript useful answers through real pooled servers', () => {
  it.each(TYPESCRIPT_PARITY_RUNTIMES)(
    'records all shared core cases with $id',
    async (runtime) => {
      const source = paritySourceIdentity()
      const fixture = await createTypeScriptParityFixture(runtime)
      const run: ParityRun = {
        fixture,
        source,
        capabilities: null,
        serverInfo: null,
        results: unrunParityResults(CORE_CASES, 'Run did not complete'),
        execution: { testPassed: false, cleanupVerified: false },
      }
      runs.push(run)
      try {
        await fixture.initialize()
        run.results = await runParityCases(fixture.session, CORE_CASES)
        expect(run.results.map((result) => result.caseId)).toEqual(CORE_CASES.map((row) => row.id))
        expect(
          run.results.map((result) => ({ caseId: result.caseId, status: result.status })),
        ).toEqual(
          CORE_CASES.map((row) => ({ caseId: row.id, status: baselineStatus(runtime.id, row.id) })),
        )
        run.execution.testPassed = true
      } finally {
        run.capabilities = fixture.session.capabilities
        run.serverInfo = fixture.client.initializeResult?.serverInfo ?? null
      }
    },
    60_000,
  )

  it('removes the project when setup fails during a real filesystem write', async () => {
    const failure = await typescriptRuntimeFixture({
      'collision/first.ts': 'export const first = 1',
      collision: 'This path is already a directory',
    }).then(
      (fixture) => fixture.dispose().then(() => null),
      (cause: unknown) => cause,
    )
    expect(failure).toMatchObject({ code: 'EISDIR' })
    if (!isRecord(failure) || typeof failure.path !== 'string') {
      expect.unreachable('Filesystem failure must identify the failed path')
    }
    const parent = path.dirname(path.dirname(failure.path))
    await expect(access(parent)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps stale and wrong-range push diagnostics pending until the unsaved marker arrives', async () => {
    const uri = 'file:///parity/src/main.ts'
    const originalStart = positionOf(CORE_PROJECT.editedMainText, 'circl)')
    const start = positionOf(CORE_PROJECT.editedMainText, CORE_PROJECT.unsavedDiagnosticMarker)
    const current: ParityDiagnostic = {
      code: 2304,
      message: `Cannot find name '${CORE_PROJECT.unsavedDiagnosticMarker}'.`,
      range: {
        start,
        end: {
          line: start.line,
          character: start.character + CORE_PROJECT.unsavedDiagnosticMarker.length,
        },
      },
    }
    const published = new Map<string, readonly ParityDiagnostic[]>([
      [
        uri,
        [
          {
            code: 2552,
            message: "Cannot find name 'circl'. Did you mean 'circle'?",
            range: {
              start: originalStart,
              end: { line: originalStart.line, character: originalStart.character + 5 },
            },
          },
        ],
      ],
    ])
    let settled = false
    const reading = waitForCorePublishedDiagnostics(published, uri).then((diagnostics) => {
      settled = true
      return diagnostics
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(settled).toBe(false)
      published.set(uri, [{ ...current, range: { ...current.range, start: originalStart } }])
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(settled).toBe(false)
    } finally {
      published.set(uri, [current])
      await reading
    }
    expect(await reading).toEqual([current])
  })
})

async function finishRun(run: ParityRun): Promise<void> {
  const { fixture } = run
  let cleanup: Awaited<ReturnType<ParityFixture['dispose']>> | null = null
  try {
    cleanup = await fixture.dispose()
    expect(cleanup.poolSize).toBe(0)
    expect(cleanup.children.length).toBeGreaterThan(0)
    await expect(access(path.dirname(fixture.root))).rejects.toMatchObject({ code: 'ENOENT' })
    run.execution.cleanupVerified = true
  } finally {
    process.stdout.write(
      JSON.stringify({
        kind: 'typescript-parity-run',
        backendId:
          fixture.metadata.runtimeKind === 'legacy' ? 'classic-tsserver' : 'native-typescript',
        engine: fixture.metadata.runtimeKind === 'legacy' ? 'classic' : 'native',
        compilerVersion: fixture.metadata.compilerVersion,
        transport: fixture.metadata.transport,
        owned: true,
        source: run.source,
        sourceAfter: paritySourceIdentity(),
        execution: run.execution,
        runtimeInfo: { ...fixture.metadata, serverInfo: run.serverInfo },
        capabilities: run.capabilities,
        uncoveredCapabilities: uncoveredCapabilityPaths(run.capabilities, CORE_CASES),
        results: run.results,
        failedEvidence: failureMessages(fixture.messages, run.results),
        cleanup,
      }) + '\n',
    )
  }
}

function baselineStatus(backend: keyof typeof BASELINE_GAPS, caseId: string) {
  const gaps = BASELINE_GAPS[backend]
  if (gaps.failed.includes(caseId)) return 'failed'
  if (gaps.unavailable.includes(caseId)) return 'unavailable'
  return 'supported'
}

function failureMessages(
  messages: Awaited<ReturnType<typeof createTypeScriptParityFixture>>['messages'],
  results: readonly ParityCaseResult[],
) {
  const failedIds = new Set(
    results.filter((result) => result.status === 'failed').map((result) => result.caseId),
  )
  const methods = new Set(
    CORE_CASES.filter((row) => failedIds.has(row.id)).flatMap((row) => row.methods),
  )
  const ids = new Set(
    messages.flatMap(({ direction, message }) =>
      direction === 'client' &&
      isRecord(message) &&
      typeof message.method === 'string' &&
      methods.has(message.method)
        ? [message.id]
        : [],
    ),
  )
  return messages.filter(({ message }) => isRecord(message) && ids.has(message.id))
}
