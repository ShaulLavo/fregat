import { expect, test } from 'vitest'
import { browserDiagnostics, drainBrowserDiagnostics } from '../diagnostics'

test('browser stderr is classified across chunks without retaining paths or page content', async () => {
  const diagnostics = browserDiagnostics()
  const source = new TextEncoder().encode(
    'ERROR: Failed to connect to the bus at /private/secret\nProcessSingleton failure\nInstalling the chromium snap\n',
  )
  await drainBrowserDiagnostics(
    new ReadableStream({
      start(controller) {
        controller.enqueue(source.slice(0, 15))
        controller.enqueue(source.slice(15))
        controller.close()
      },
    }),
    diagnostics,
  )
  expect(diagnostics.snapshot()).toEqual({
    stderrBytes: source.length,
    stderrClasses: { dbus: 1, singleton: 1, snap: 1 },
  })
  expect(JSON.stringify(diagnostics.snapshot())).not.toContain('secret')
})

test('long unterminated stderr retains a bounded suffix and reports fixed failure classes', () => {
  const diagnostics = browserDiagnostics()
  diagnostics.add('private'.repeat(100_000))
  diagnostics.add(' No usable sandbox')
  diagnostics.finish()
  expect(diagnostics.snapshot()).toEqual({
    stderrBytes: 700_018,
    stderrClasses: { sandbox: 1 },
  })
})
