import { expect, test } from 'vitest'
import { browserDiagnostics, browserProcessFacts, drainBrowserDiagnostics } from '../diagnostics'

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

test('process diagnostic facts classify descriptors and omit private process paths', () => {
  const facts = browserProcessFacts(42, '/private/configured', [17, 18], {
    read: () => '42 (private process) S 1 2 3',
    real: () => '/private/chrome',
    link: (file) => {
      if (file.endsWith('/exe')) return '/private/chrome'
      if (file.endsWith('/3') || file.endsWith('/17')) return 'socket:[private-id]'
      return 'pipe:[private-id]'
    },
  })
  expect(facts).toEqual({
    processState: 'S',
    processExecutableClass: 'browser',
    processMatchesSelected: true,
    childWriteDescriptor: 'socket',
    childReadDescriptor: 'pipe',
    parentWriteDescriptor: 'socket',
    parentReadDescriptor: 'pipe',
  })
  expect(JSON.stringify(facts)).not.toContain('private')
})

test('missing process descriptors and unsupported identities have explicit fixed facts', () => {
  const facts = browserProcessFacts(42, '/private/configured', [17, 18], {
    read: () => '42 (private process) unknown 1',
    real: () => '/private/selected',
    link: (file) => {
      if (file.endsWith('/exe')) return '/private/bash'
      throw undefined
    },
  })
  expect(facts).toMatchObject({
    processState: 'unavailable',
    processExecutableClass: 'shell',
    processMatchesSelected: false,
    parentWriteDescriptor: 'unavailable',
    childReadDescriptor: 'unavailable',
  })
  expect(JSON.stringify(facts)).not.toContain('private')
})
