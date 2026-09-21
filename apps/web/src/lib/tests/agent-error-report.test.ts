import { expect, test } from '../../../test/fixtures'
import { agentErrorReport } from '@/lib/agent-error-report'
import { toClientError } from '@/lib/client-error-taxonomy'

const AT = new Date('2026-09-21T10:00:00.000Z')

test('carries the catalog answer and the command that finds the wide event', () => {
  const error = toClientError({
    error: {
      code: 'settings.UNKNOWN_KEY',
      message: 'Unknown setting: workbench.surface.continuousSeams',
      why: 'The write named a setting this build does not register.',
      fix: 'Compare GET /platform/release.',
    },
  })

  const report = agentErrorReport(error, AT)
  expect(report).toContain('code: settings.UNKNOWN_KEY')
  expect(report).toContain('why: The write named a setting')
  expect(report).toContain('fix: Compare GET /platform/release.')
  // A minute of slack before the toast: the wide event is written when the
  // request finished, not when the user got round to copying it.
  expect(report).toContain('logs: bun run logs --since 2026-09-21T09:59:00.000Z')
})

test('a failure with no catalog envelope still names its code slot', () => {
  const report = agentErrorReport(toClientError(new Error('boom')), AT)
  expect(report).toContain('code: unknown')
  expect(report).not.toContain('why:')
})
