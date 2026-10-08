import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import {
  recordOf,
  removeSandboxes,
  sandbox,
  start,
  until,
  userScopes,
  writeMachine,
  writeSettings,
} from './sandbox'

const locks = process.platform === 'linux' ? await import('./lock').catch(() => null) : null
const queue = locks ? await import('./queue') : null
const transport = 'Failed to start transient scope unit: Transport endpoint is not connected'

afterEach(removeSandboxes)

function launchBox(diagnostic: string, exitCode: number, accounted = false, split = false) {
  const box = sandbox()
  const bin = path.join(box.root, 'bin')
  const calls = path.join(box.root, 'launches')
  mkdirSync(bin)
  writeMachine(box, { availableMiB: 65536 })
  writeSettings(box, { 'developer.heavyJobQuietHoldSeconds': 600 })
  writeFileSync(
    path.join(bin, 'systemctl'),
    '#!/bin/bash\nif [[ "$2" == show ]]; then echo not-found; fi\nexit 0\n',
    { mode: 0o755 },
  )
  const emit = split
    ? `for ((i=0; i<8192; i++)); do printf 'relay α\\n' >&2; done\nprintf '%s' ${JSON.stringify(diagnostic.slice(0, 40))} >&2\nsleep 0.02\nprintf '%s\\n' ${JSON.stringify(diagnostic.slice(40))} >&2`
    : `printf '%s\\n' ${JSON.stringify(diagnostic)} >&2`
  writeFileSync(
    path.join(bin, 'systemd-run'),
    `#!/bin/bash\nprintf 'launch\\n' >> ${JSON.stringify(calls)}\n${accounted ? 'for arg in "$@"; do [[ "$arg" != *.accounting ]] || printf "exit 1\\n" > "$arg"; done\n' : ''}${emit}\nexit ${exitCode}\n`,
    { mode: 0o755 },
  )
  return { box, calls, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }
}

function released(box: ReturnType<typeof sandbox>) {
  expect(queue!.live(box.state, 'queue')).toEqual([])
  expect(queue!.live(box.state, 'jobs')).toEqual([])
  for (const name of ['admission.lock', 'slot1.lock', 'slot2.lock', 'slot3.lock']) {
    const fd = locks!.tryLock(path.join(box.state, name))
    if (fd !== null) locks!.unlock(fd)
    expect(fd).not.toBeNull()
  }
}

test.for([
  { quiet: false, split: false },
  { quiet: true, split: false },
  { quiet: false, split: true },
])(
  'a scope transport failure fails clearly and releases admission (%j)',
  async ({ quiet, split }, context) => {
    if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
    const { box, calls, env } = launchBox(transport, 1, false, split)
    const payload = path.join(box.root, 'payload')
    const job = start(box, 'transport-failure', ['touch', payload], {
      env,
      jobClass: 'light',
      machine: true,
      quiet,
    })
    const result = await job.done
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('systemd lost its connection while launching')
    expect(result.stderr).toContain(
      'The manager may have accepted the scope before the connection closed.',
    )
    expect(result.stderr).toContain('journalctl --user')
    expect(result.stderr).toContain(transport)
    if (split) expect(result.stderr).toContain('relay α\n'.repeat(8192))
    expect(readFileSync(calls, 'utf8')).toBe('launch\n')
    expect(existsSync(payload)).toBe(false)
    expect(recordOf(box, 'transport-failure')).toMatchObject({
      exitCode: 1,
      level: 'error',
      launchFailure: 'manager-transport',
    })
    released(box)
    if (quiet) expect(readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')).toBe('')
  },
)

test.for([
  {
    diagnostic: 'Failed to start transient scope unit: Access denied',
    exitCode: 1,
    accounted: false,
  },
  { diagnostic: transport, exitCode: 1, accounted: true },
  { diagnostic: transport, exitCode: 0, accounted: false },
])(
  'another outcome keeps its original exit and diagnostic (%j)',
  async ({ diagnostic, exitCode, accounted }, context) => {
    if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
    const { box, calls, env } = launchBox(diagnostic, exitCode, accounted)
    const result = await start(box, 'control', ['true'], {
      env,
      jobClass: 'light',
      machine: true,
    }).done
    expect(result.code).toBe(exitCode)
    expect(result.stderr).toContain(diagnostic)
    expect(result.stderr).not.toContain('systemd lost its connection')
    expect(readFileSync(calls, 'utf8')).toBe('launch\n')
    released(box)
  },
)

test('a launched payload retains the caller stderr descriptor and closes the handoff', async (context) => {
  if (!locks || !userScopes) context.skip('Requires Linux user scopes and Bun FFI')
  const box = sandbox()
  writeMachine(box, { availableMiB: 65536 })
  const release = path.join(box.root, 'release')
  const job = start(
    box,
    'stderr-handoff',
    [
      'bash',
      '-c',
      `readlink /proc/$$/fd/2 >&2; [[ ! -e /proc/$$/fd/7 ]] || exit 1; echo ready; ${until(release)}`,
    ],
    { machine: true, jobClass: 'light' },
  )
  try {
    await expect.poll(job.stdout, { timeout: 5000 }).toContain('ready')
    expect(job.stderr()).toContain(readlinkSync(`/proc/${job.child.pid}/fd/2`))
    writeFileSync(release, '')
    expect((await job.done).code).toBe(0)
    released(box)
  } finally {
    writeFileSync(release, '')
    job.child.kill('SIGTERM')
    await job.done
  }
})
