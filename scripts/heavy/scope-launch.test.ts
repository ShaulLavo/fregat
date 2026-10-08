import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import {
  recordOf,
  records,
  firstDecision,
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
    expect(readFileSync(calls, 'utf8')).toBe('launch\nlaunch\n')
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
    await expect.poll(job.stderr).toContain(readlinkSync(`/proc/${job.child.pid}/fd/2`))
    writeFileSync(release, '')
    expect((await job.done).code).toBe(0)
    released(box)
  } finally {
    writeFileSync(release, '')
    job.child.kill('SIGTERM')
    await job.done
  }
})

function recoveryBox(
  options: {
    helper?: boolean
    cleanupFailure?: boolean
    cleanupWait?: boolean
    active?: boolean
    wait?: boolean
  } = {},
) {
  const fixture = launchBox(transport, 1)
  const { box, calls } = fixture
  const manager = path.join(box.root, 'manager')
  const attempts = path.join(box.root, 'attempts')
  const release = path.join(box.root, 'release-launch')
  const helper = path.join(box.root, 'helper.pid')
  writeSettings(box, {
    'developer.heavyJobQuietHoldSeconds': 600,
    'developer.heavyJobStopGraceSeconds': 1,
  })
  writeFileSync(
    path.join(box.root, 'bin', 'systemctl'),
    `#!/bin/bash
printf '%s\\n' "$*" >> ${JSON.stringify(manager)}
${options.cleanupFailure ? '[[ "$2" != stop ]] || exit 1' : ''}
${options.cleanupWait ? `[[ "$2" != stop ]] || { exec >/dev/null; ${until(release)}; }` : ''}
if [[ "$2" == show ]]; then
  if [[ "$*" == *LoadState* ]]; then echo loaded; else echo ${options.active ? 'active' : 'inactive'}; fi
fi
exit 0
`,
    { mode: 0o755 },
  )
  writeFileSync(
    path.join(box.root, 'bin', 'systemd-run'),
    `#!/bin/bash
printf 'launch\\n' >> ${JSON.stringify(calls)}
printf '%s\\n' "$*" >> ${JSON.stringify(attempts)}
if [[ $(wc -l < ${JSON.stringify(calls)}) == 1 ]]; then
  ${options.helper ? `(exec >/dev/null 3<&- 4<&- 5<&- 6<&- 7<&-; sleep 30) & echo $! > ${JSON.stringify(helper)}` : ''}
  printf '%s\\n' ${JSON.stringify(transport)} >&2
  ${options.wait ? until(release) : ''}
  exit 1
fi
while [[ "$1" != *.accounting ]]; do shift; done
accounting=$1
shift
exec 6<&- 2>&7 7>&-
"$@" 3<&- 4<&- 5<&-
rc=$?
printf 'exit %s\\n' "$rc" > "$accounting"
exit "$rc"
`,
    { mode: 0o755 },
  )
  return { ...fixture, manager, attempts, release, helper }
}

test('a transport retry retains admission until its single payload execution finishes', async (context) => {
  if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
  const { box, calls, env, manager, attempts, release: launchGate } = recoveryBox({ wait: true })
  const payload = path.join(box.root, 'payload')
  const release = path.join(box.root, 'release-payload')
  const job = start(
    box,
    'recovered',
    ['bash', '-c', `echo run >> ${payload}; echo ready; ${until(release)}`],
    { env, quiet: true, machine: true, jobClass: 'light' },
  )
  let successor: ReturnType<typeof start> | undefined
  try {
    await expect.poll(job.stderr).toContain(transport)
    const originalEntry = queue!.live(box.state, 'jobs')[0]
    writeFileSync(launchGate, '')
    await expect.poll(job.stdout).toContain('ready')
    expect(queue!.live(box.state, 'jobs')[0]).toEqual(originalEntry)
    expect(readFileSync(payload, 'utf8')).toBe('run\n')
    expect(readFileSync(calls, 'utf8')).toBe('launch\nlaunch\n')
    const commands = readFileSync(attempts, 'utf8').trim().split('\n')
    expect(commands[1]).toBe(commands[0])
    expect(readFileSync(manager, 'utf8')).toContain('--user stop')
    expect(readFileSync(manager, 'utf8').match(/set-property/g)).toHaveLength(2)
    expect(queue!.live(box.state, 'jobs')).toHaveLength(1)
    expect(readFileSync(path.join(box.state, 'queue', 'sequence'), 'utf8')).toBe('1')
    for (const name of ['slot1.lock', 'slot2.lock', 'slot3.lock']) {
      const fd = locks!.tryLock(path.join(box.state, name))
      if (fd !== null) locks!.unlock(fd)
      expect(fd).toBeNull()
    }
    successor = start(box, 'successor', ['true'], {
      env,
      quiet: true,
      machine: true,
      jobClass: 'light',
    })
    expect(await firstDecision(successor)).toBe('waiting')
    expect(readFileSync(calls, 'utf8')).toBe('launch\nlaunch\n')
    writeFileSync(release, '')
    expect((await job.done).code).toBe(0)
    const recoveryLogs = job
      .stderr()
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line))
      .filter((event) => event.action === 'heavy.scope-recovery')
    expect(recoveryLogs).toMatchObject([
      { level: 'warn', retryLimit: 1 },
      { level: 'info', retries: 1, status: 'recovered' },
    ])
    expect(records(box)).toHaveLength(1)
    expect(recordOf(box, 'recovered')).toMatchObject({
      exitCode: 0,
      recovery: { retries: 1, initialExitCode: 1, status: 'recovered' },
    })
    expect((await successor.done).code).toBe(0)
    released(box)
  } finally {
    writeFileSync(launchGate, '')
    writeFileSync(release, '')
    job.child.kill('SIGTERM')
    successor?.child.kill('SIGTERM')
    await job.done
    await successor?.done
  }
})

test('an external diagnostic writer cannot retain admission beyond the stop grace', async (context) => {
  if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
  const { box, calls, env, helper } = recoveryBox({ helper: true, cleanupFailure: true })
  const job = start(box, 'external-writer', ['true'], { env, machine: true, jobClass: 'light' })
  try {
    await expect.poll(() => recordOf(box, 'external-writer'), { timeout: 3000 }).toBeDefined()
    expect((await job.done).code).toBe(2)
    expect(readFileSync(calls, 'utf8')).toBe('launch\n')
    expect(process.kill(Number(readFileSync(helper, 'utf8')), 0)).toBe(true)
    released(box)
    const successor = await start(box, 'writer-successor', ['true'], {
      env,
      quiet: true,
      machine: true,
      jobClass: 'light',
    }).done
    expect(successor.code).toBe(0)
  } finally {
    if (existsSync(helper)) process.kill(Number(readFileSync(helper, 'utf8')), 'SIGKILL')
    job.child.kill('SIGTERM')
    await job.done
  }
})

test.for(['ENOSPC', undefined])(
  'a forwarding failure preserves the transport diagnosis and the completed receipt (%s)',
  async (code, context) => {
    if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
    const { box, calls, env } = recoveryBox({ cleanupFailure: true })
    const preload = path.join(box.root, 'write-failure.ts')
    writeFileSync(
      preload,
      `const original = Bun.write; Bun.write = (target, ...args) => { if (target === Bun.stderr) return Promise.reject(${code === undefined ? 'undefined' : JSON.stringify({ code })}); return original(target, ...args) }`,
    )
    const result = await start(box, 'write-failure', ['true'], {
      env,
      preload,
      machine: true,
      jobClass: 'light',
    }).done
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('systemd lost its connection')
    expect(records(box)).toHaveLength(1)
    expect(recordOf(box, 'write-failure')).toMatchObject({
      exitCode: 1,
      launchFailure: 'manager-transport',
      stderrFailure: { kind: 'write', code: code ?? null },
    })
    expect(readFileSync(calls, 'utf8')).toBe('launch\n')
    released(box)
  },
)

test('an expired quiet deadline prevents a transport retry and keeps expiry accounting', async (context) => {
  if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
  const { box, calls, env, release } = recoveryBox({ wait: true })
  writeSettings(box, {
    'developer.heavyJobQuietHoldSeconds': 1,
    'developer.heavyJobStopGraceSeconds': 1,
  })
  const job = start(box, 'expired-recovery', ['true'], {
    env,
    quiet: true,
    machine: true,
    jobClass: 'light',
  })
  try {
    const result = await job.done
    expect(result.code).toBe(75)
    expect(readFileSync(calls, 'utf8')).toBe('launch\n')
    expect(recordOf(box, 'expired-recovery')).toMatchObject({ quietHoldExpired: true })
    expect(recordOf(box, 'expired-recovery')?.recovery).toBeUndefined()
    released(box)
  } finally {
    writeFileSync(release, '')
    job.child.kill('SIGTERM')
    await job.done
  }
})

test.for([{ cleanupWait: true }, { active: true }])(
  'unconfirmed cleanup prevents a fresh launch (%j)',
  async (options, context) => {
    if (!locks) context.skip('Requires Bun FFI and a libc flock implementation')
    const { box, calls, env, release } = recoveryBox(options)
    const job = start(box, 'unconfirmed-cleanup', ['true'], {
      env,
      machine: true,
      jobClass: 'light',
    })
    try {
      const result = await job.done
      expect(result.code).toBe(2)
      expect(readFileSync(calls, 'utf8')).toBe('launch\n')
      expect(recordOf(box, 'unconfirmed-cleanup')).toMatchObject({
        exitCode: 1,
        recovery: { retries: 0, status: 'cleanup-failed' },
      })
      released(box)
    } finally {
      writeFileSync(release, '')
      job.child.kill('SIGTERM')
      await job.done
    }
  },
)

test.for([false, true])(
  'a quiet payload admits light followers and excludes suite successors after recovery=%s',
  async (recover, context) => {
    if (!locks || !userScopes) context.skip('Requires Linux user scopes and Bun FFI')
    const systemdRun = Bun.which('systemd-run')!
    const box = sandbox()
    writeMachine(box, { availableMiB: 65536 })
    writeSettings(box, { 'developer.heavyJobQuietHoldSeconds': 600 })
    const bin = path.join(box.root, 'bin')
    const attempts = path.join(box.root, 'attempts')
    const launchGate = path.join(box.root, 'release-launch')
    const payloadGate = path.join(box.root, 'release-payload')
    mkdirSync(bin)
    writeFileSync(
      path.join(bin, 'systemd-run'),
      `#!/bin/bash
if [[ "$*" == *--scope* ]]; then
  printf 'launch\\n' >> ${JSON.stringify(attempts)}
  if [[ ${recover ? 'yes' : 'no'} == yes && $(wc -l < ${JSON.stringify(attempts)}) == 1 ]]; then
    printf '%s\\n' ${JSON.stringify(transport)} >&2
    ${until(launchGate)}
    exit 1
  fi
fi
exec ${JSON.stringify(systemdRun)} "$@"
`,
      { mode: 0o755 },
    )
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` }
    const job = start(box, 'light-policy', ['bash', '-c', `echo ready; ${until(payloadGate)}`], {
      env,
      quiet: true,
      machine: true,
      jobClass: 'light',
    })
    let light: ReturnType<typeof start> | undefined
    let suite: ReturnType<typeof start> | undefined
    try {
      if (recover) await expect.poll(job.stderr).toContain(transport)
      if (!recover) await expect.poll(job.stdout).toContain('ready')
      const originalEntry = queue!.live(box.state, 'jobs')[0]!
      const runFile = path.join(box.state, 'runs', `${originalEntry.id}.json`)
      const journalFile = path.join(box.state, 'measurements', `${originalEntry.id}.json`)
      const originalRun = JSON.parse(readFileSync(runFile, 'utf8'))
      const originalJournal = readFileSync(journalFile, 'utf8')
      writeFileSync(launchGate, '')
      await expect.poll(job.stdout).toContain('ready')
      expect(queue!.live(box.state, 'jobs')[0]).toEqual(originalEntry)
      expect(readFileSync(journalFile, 'utf8')).toBe(originalJournal)
      expect(readFileSync(attempts, 'utf8').trim().split('\n')).toHaveLength(recover ? 2 : 1)
      light = start(box, 'permitted-light', ['true'], { env, machine: true, jobClass: 'light' })
      expect(await firstDecision(light)).toBe('started')
      expect(JSON.parse(readFileSync(runFile, 'utf8'))).toEqual(originalRun)
      expect((await light.done).code).toBe(0)
      suite = start(box, 'excluded-suite', ['true'], { env, machine: true, jobClass: 'suite' })
      expect(await firstDecision(suite)).toBe('waiting')
      writeFileSync(payloadGate, '')
      expect((await job.done).code).toBe(0)
      expect(recordOf(box, 'light-policy')?.jobsDuringRun).toMatchObject([
        { label: 'permitted-light' },
      ])
      expect((await suite.done).code).toBe(0)
      released(box)
    } finally {
      writeFileSync(launchGate, '')
      writeFileSync(payloadGate, '')
      job.child.kill('SIGTERM')
      light?.child.kill('SIGTERM')
      suite?.child.kill('SIGTERM')
      await Promise.all([job.done, light?.done, suite?.done])
    }
  },
)
