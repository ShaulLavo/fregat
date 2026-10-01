import { expect, test } from 'vitest'
import { CdpClient } from '../cdp'
import { launcherFailureFacts, reportStartFailure } from '../failure'
import { launcherErrors } from '../structured-errors'

test.each([-32602, 'private protocol code'])(
  'CDP request failure preserves safe operation facts for code %s',
  async (protocolCode) => {
    let input!: ReadableStreamDefaultController<Uint8Array>
    const cdp = new CdpClient({
      input: new ReadableStream({
        start(controller) {
          input = controller
        },
      }),
      async write(bytes) {
        const request = JSON.parse(new TextDecoder().decode(bytes).slice(0, -1))
        input.enqueue(
          new TextEncoder().encode(
            JSON.stringify({
              id: request.id,
              error: { code: protocolCode, message: 'private protocol text' },
            }) + '\0',
          ),
        )
      },
      close() {},
    })
    try {
      const failure = await cdp.request('Browser.grantPermissions').catch((error: unknown) => error)
      const event = { outcome: 'failed', ...launcherFailureFacts(failure) }
      expect(event).toMatchObject({
        outcome: 'failed',
        code: 'desktop.launcher.CDP_FAILED',
        internal: {
          reason: 'request-error',
          method: 'Browser.grantPermissions',
          protocolCode: typeof protocolCode === 'number' ? protocolCode : null,
        },
      })
      expect(JSON.stringify(event)).not.toContain('private protocol')
      expect(event.why).toBeTruthy()
      expect(event.fix).toBeTruthy()
    } finally {
      cdp.close()
    }
  },
)

test('pre-window failure writes public guidance and structured facts to stderr/log and exits nonzero', () => {
  const failure = launcherErrors.LAUNCH_FAILED({
    internal: { reason: 'tab-opener-exit', exitCode: 7 },
  })
  const logs: unknown[] = []
  const stderr: string[] = []
  let exitCode = 0
  reportStartFailure(failure, {
    log: (facts) => {
      logs.push(facts)
    },
    stderr: (line) => {
      stderr.push(line)
    },
    exit: (code) => {
      exitCode = code
    },
  })
  expect(exitCode).toBe(1)
  expect(logs).toEqual([launcherFailureFacts(failure)])
  expect(JSON.parse(stderr[0]!)).toMatchObject({
    event: 'desktop.start_failed',
    code: 'desktop.launcher.LAUNCH_FAILED',
    why: failure.why,
    fix: failure.fix,
    internal: { reason: 'tab-opener-exit', exitCode: 7 },
  })
})

test('unstructured failures cannot leak process arguments through the public failure surface', () => {
  const facts = launcherFailureFacts({ message: '/private/path --secret=value' })
  expect(facts).toMatchObject({
    code: 'desktop.launcher.LAUNCH_FAILED',
    internal: { reason: 'unclassified-failure', errorType: 'object' },
  })
  expect(JSON.stringify(facts)).not.toContain('private')
  expect(JSON.stringify(facts)).not.toContain('secret')
})
