import path from 'node:path'
import { expect, test } from 'vitest'
import { readFsLogs } from 'evlog/fs'
import type { WideEvent } from 'evlog'
import * as v from 'valibot'
import { providerInstanceIdSchema } from '@workspace/contracts'
import {
  crashingDiscoveryProcess,
  hangingDiscoveryProcess,
} from '../../../test/factories/discovery-process'
import { discoverClaudeSessions, runClaudeDiscovery } from '../../provider/claude-discovery'
import {
  flushObservability,
  initializeObservability,
  resetObservabilityForTests,
} from '../../observability/runtime'
import { SessionDiscoveryReconciler } from '../session-discovery'
import { discoveryFixture } from './factories/discovery'

test.each([
  {
    outcome: 'crashes',
    spawn: crashingDiscoveryProcess,
    timedOut: false,
    exitCode: 37,
    signalCode: null,
    stderr: 'discovery fixture crash\n',
  },
  {
    outcome: 'hangs',
    spawn: hangingDiscoveryProcess,
    timedOut: true,
    exitCode: expect.any(Number),
    signalCode: 'SIGTERM',
    stderr: 'discovery fixture hung\n',
  },
])(
  'the wide scan event preserves child diagnostics when discovery $outcome',
  async ({ spawn, ...expected }) => {
    const fixture = await discoveryFixture()
    const logDir = path.join(fixture.root, 'logs')
    const providerInstanceId = v.parse(providerInstanceIdSchema, 'claude-diagnostics')
    initializeObservability({
      OBSERVABILITY_CONSOLE: 'false',
      OBSERVABILITY_DIR: logDir,
      OBSERVABILITY_ENABLED: 'true',
      OBSERVABILITY_INFO_SAMPLE_RATE: '100',
      NODE_ENV: 'production',
    })
    const reconciler = new SessionDiscoveryReconciler({
      ...fixture,
      dispatch: (command) => fixture.engine.dispatch(command),
      providerService: {
        ...fixture.providerHistory,
        discoveryInstances: () => [providerInstanceId],
        discoverSessions: (request) =>
          discoverClaudeSessions({
            request,
            env: {},
            runner: (input) => runClaudeDiscovery(input, spawn),
          }),
      },
    })
    try {
      await fixture.register()
      expect(await reconciler.scan()).toMatchObject({ skipped: { 'provider-scan-failed': 1 } })
      await flushObservability()
      const scans: WideEvent[] = []
      for await (const event of readFsLogs({ dir: logDir })) {
        if (event.action === 'chat.pipeline.discovery.scan') scans.push(event)
      }
      expect(scans).toHaveLength(1)
      expect(scans[0]).toMatchObject({
        level: 'warn',
        skipped: { 'provider-scan-failed': 1 },
        failures: [
          {
            stage: 'provider-scan',
            providerInstanceId,
            cwd: fixture.main,
            offset: 0,
            error: {
              code: 'provider.DISCOVERY_FAILED',
              internal: {
                exitCode: expected.exitCode,
                signalCode: expected.signalCode,
                stderr: expected.stderr,
                timedOut: expected.timedOut,
                timeoutMs: 8_000,
              },
            },
          },
        ],
      })
    } finally {
      await reconciler.close()
      await resetObservabilityForTests()
      await fixture.close()
    }
  },
  12_000,
)
