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
    list: () => [],
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
    majorFaults: null,
    cpuTicks: null,
    ioReadBytes: null,
    ioWriteBytes: null,
    threadStates: {},
    blockedWaits: {},
  })
  expect(JSON.stringify(facts)).not.toContain('private')
})

test('missing process descriptors and unsupported identities have explicit fixed facts', () => {
  const facts = browserProcessFacts(42, '/private/configured', [17, 18], {
    read: () => '42 (private process) unknown 1',
    real: () => '/private/selected',
    list: () => {
      throw undefined
    },
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

test('blocked threads report kernel wait and syscall classes with fault and IO counters', () => {
  const stat = (state: string) =>
    `7 (private name) ${state} 1 2 3 4 5 6 7 8 31 9 120 30 ${Array(40).fill(0).join(' ')}`
  const files: Record<string, string> = {
    '/proc/7/stat': stat('D'),
    '/proc/7/io': 'rchar: 1\nread_bytes: 250000000\nwrite_bytes: 4096\n',
    '/proc/7/task/7/stat': stat('D'),
    '/proc/7/task/7/wchan': 'folio_wait_bit_common',
    '/proc/7/task/7/syscall': '-1 0x7ffd 0x7f12',
    '/proc/7/task/8/stat': stat('D'),
    '/proc/7/task/8/wchan': 'jbd2_log_wait_commit',
    '/proc/7/task/8/syscall': '75 0x3 0x0',
    '/proc/7/task/9/stat': stat('D'),
    '/proc/7/task/9/wchan': '/private/path',
    '/proc/7/task/10/stat': stat('S'),
  }
  for (let thread = 11; thread < 21; thread++) {
    files[`/proc/7/task/${thread}/stat`] = stat('D')
    files[`/proc/7/task/${thread}/wchan`] = `wait_${thread}`
    files[`/proc/7/task/${thread}/syscall`] = '202 0x0'
  }
  const facts = browserProcessFacts(7, '/private/configured', [17, 18], {
    read: (file) => {
      if (file in files) return files[file]!
      throw undefined
    },
    real: () => '/private/chrome',
    link: () => '/private/chrome',
    list: () =>
      Object.keys(files).flatMap((file) => /^\/proc\/7\/task\/(\d+)\/stat$/.exec(file)?.[1] ?? []),
  })
  expect(facts).toMatchObject({
    processState: 'D',
    majorFaults: 31,
    cpuTicks: 150,
    ioReadBytes: 250_000_000,
    ioWriteBytes: 4096,
    threadStates: { D: 13, S: 1 },
    blockedWaits: {
      'folio_wait_bit_common:-1': 1,
      'jbd2_log_wait_commit:75': 1,
      'unavailable:unavailable': 1,
    },
  })
  expect(Object.keys(facts.blockedWaits)).toHaveLength(8)
  expect(JSON.stringify(facts)).not.toContain('private')
})
