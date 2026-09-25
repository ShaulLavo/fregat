import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readFsLogs } from 'evlog/fs'
import type { WideEvent } from 'evlog'
import { afterEach, expect, it } from 'vitest'
import {
  flushObservability,
  initializeObservability,
  resetObservabilityForTests,
} from '../../observability/runtime'
import { createStructuredError } from '../../observability/structured-errors'
import { recordChatPipelineWarning } from '../orchestration-logging'

const roots: string[] = []

afterEach(async () => {
  await resetObservabilityForTests()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

it('keeps an error’s internal facts on a pipeline event and redacts sensitive keys', async () => {
  const logDir = await mkdtemp(path.join(tmpdir(), 'platform-orchestration-logging-'))
  roots.push(logDir)
  initializeObservability({
    OBSERVABILITY_CONSOLE: 'false',
    OBSERVABILITY_DIR: logDir,
    OBSERVABILITY_ENABLED: 'true',
    OBSERVABILITY_INFO_SAMPLE_RATE: '100',
    NODE_ENV: 'production',
  })
  const cause = createStructuredError({
    code: 'orchestration.TEST_CAUSE',
    message: 'Cause failed.',
    internal: { attempt: 2, secret: 'private-cause-secret' },
  })
  const error = createStructuredError({
    code: 'orchestration.TEST_FAILURE',
    message: 'Pipeline step failed.',
    cause,
    internal: {
      deliveryId: 7,
      token: 'private-token',
      nested: { path: '/private/place', items: 3 },
    },
  })

  recordChatPipelineWarning('chat.pipeline.test.failure', { error })
  await flushObservability()
  const events: WideEvent[] = []
  for await (const event of readFsLogs({ dir: logDir })) events.push(event)
  const event = events.find((candidate) => candidate.action === 'chat.pipeline.test.failure')

  expect(event).toMatchObject({
    level: 'warn',
    error: {
      code: 'orchestration.TEST_FAILURE',
      internal: {
        deliveryId: 7,
        token: '[redacted]',
        nested: { path: '[redacted]', items: 3 },
      },
      cause: {
        code: 'orchestration.TEST_CAUSE',
        internal: { attempt: 2, secret: '[redacted]' },
      },
    },
  })
  const serialized = JSON.stringify(event)
  for (const value of ['private-token', '/private/place', 'private-cause-secret']) {
    expect(serialized).not.toContain(value)
  }
})
