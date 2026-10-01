import { expect, test } from 'vitest'
import { hasSingletonOwner } from '../singleton'

function probe(lock: string | undefined, command: string | undefined) {
  return hasSingletonOwner('/state/desktop/chromium', 'host', '/usr/bin/chromium', {
    readLink: (file) => (file === '/proc/42/exe' ? '/usr/lib/chromium/chromium' : lock),
    realPath: (file) => file,
    readFile: (file) => (file === '/proc/42/cmdline' ? command : undefined),
  })
}
const command =
  '/usr/lib/chromium/chromium\0--user-data-dir=/state/desktop/chromium\0--remote-debugging-pipe\0'

test('only a live local CDP process for the exact profile confirms handoff', () => {
  expect(probe('host-42', command)).toBe(true)
})
test.each([undefined, 'foreign-42', 'host-not-pid', 'host-0', 'host-../42', 'host-43'])(
  'stale/malformed/foreign singleton %s grants no ownership',
  (lock) => {
    expect(probe(lock, command)).toBe(false)
  },
)
test.each([
  undefined,
  '/bin/true\0',
  '--user-data-dir=/other\0--remote-debugging-pipe\0',
  '--user-data-dir=/state/desktop/chromium\0',
])('foreign/uncontrolled process cannot confirm a handoff', (value) => {
  expect(probe('host-42', value)).toBe(false)
})

test.each(Array.from({ length: 30 }, (_, run) => run))(
  'joined Chromium process title confirms exact launcher profile run %i',
  () => {
    const title =
      '/usr/lib/chromium/chromium --app=http://localhost/ --user-data-dir=/state/desktop/chromium --profile-directory=Platform --remote-debugging-pipe --no-first-run\0'
    expect(probe('host-42', title)).toBe(true)
    expect(title.split('\0').includes('--user-data-dir=/state/desktop/chromium')).toBe(false)
  },
)
test.each([
  '/usr/bin/chromium --user-data-dir=/state/desktop/chromium-extra --profile-directory=Platform --remote-debugging-pipe\0',
  '/usr/bin/chromium --user-data-dir=/state/desktop/chromium extra --profile-directory=Platform --remote-debugging-pipe\0',
  '/usr/bin/chromium --user-data-dir=/state/desktop/chromium --profile-directory=Other --remote-debugging-pipe\0',
  '/usr/bin/chromium --user-data-dir=/state/desktop/chromium --profile-directory=Platform --remote-debugging-pipe-extra\0',
])('joined process titles require the exact contiguous launcher signature %s', (title) => {
  expect(probe('host-42', title)).toBe(false)
})
test('joined process titles retain exact profiles containing spaces', () => {
  const profile = '/state home/desktop/chromium'
  expect(
    hasSingletonOwner(profile, 'host', '/usr/bin/chromium', {
      readLink: (file) => (file === '/proc/42/exe' ? '/usr/lib/chromium/chromium' : 'host-42'),
      realPath: (file) => file,
      readFile: () =>
        `/usr/bin/chromium --user-data-dir=${profile} --profile-directory=Platform --remote-debugging-pipe\0`,
    }),
  ).toBe(true)
})

test.each(['/bin/true', '/tmp/custom-wrapper', '/tmp/chromium'])(
  'an existing Chromium owner cannot validate unrelated selected executable %s',
  (executable) => {
    expect(
      hasSingletonOwner('/state/desktop/chromium', 'host', executable, {
        readLink: (file) => (file === '/proc/42/exe' ? '/usr/lib/chromium/chromium' : 'host-42'),
        readFile: () => command,
        realPath: (file) => file,
      }),
    ).toBe(false)
  },
)
