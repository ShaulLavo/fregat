import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import {
  alive,
  type Box,
  heavy,
  MiB,
  records,
  removeSandboxes,
  sandbox,
  start,
  startExternal,
  unitActive,
  until,
  writeMachine,
  userScopes,
} from './sandbox'
import { tryLock, unlock } from './lock'

afterEach(removeSandboxes)

const RUN = path.join(import.meta.dirname, 'run.ts')

const allocate = (mib: number) =>
  ['bun', '-e', `const b = Buffer.alloc(${mib} * 2 ** 20, 1); console.log(b.length)`] as const
const spin = (ms: number) =>
  [
    'bun',
    '-e',
    `const start = process.cpuUsage(); const end = Date.now() + ${ms}; while (true) { const used = process.cpuUsage(start); if (used.user + used.system >= ${ms} * 1000 && Date.now() >= end) break }`,
  ] as const

function runBox() {
  const box = sandbox()
  writeMachine(box, { availableMiB: 65536 })
  return box
}

const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  }).stdout.trim()

function repository(dir: string) {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q')
  git(dir, 'commit', '-q', '--allow-empty', '-m', path.basename(dir))
  return git(dir, 'rev-parse', 'HEAD')
}

// A PATH holding every tool the wrapper and its job reach for, with `git` left out.
function pathWithoutGit(box: Box) {
  const bin = path.join(box.root, 'no-git')
  mkdirSync(bin)
  for (const dir of (process.env.PATH ?? '').split(':')) {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      if (name === 'git' || existsSync(path.join(bin, name))) continue
      symlinkSync(path.join(dir, name), path.join(bin, name))
    }
  }
  return bin
}

describe.skipIf(!userScopes)('a job run through the wrapper', () => {
  test('records the peak memory and CPU time of its own cgroup scope', async () => {
    const box = runBox()
    const result = await heavy(box, 'alloc-220', allocate(220), { machine: true })
    expect(result.code).toBe(0)

    const [record] = records(box)
    expect(record?.memoryPeakBytes).toBeGreaterThanOrEqual(200 * MiB)
    expect(record?.cpuUsageUsec).toBeGreaterThan(0)
    expect(record).toMatchObject({
      area: 'heavy-jobs',
      command: [...allocate(220)],
      cwd: box.root,
      exitCode: 0,
      host: 'local',
      label: 'alloc-220',
      level: 'info',
      oomKills: 0,
      source: 'heavy',
    })
    expect(record?.unit).toMatch(new RegExp(`^${box.sliceRoot}-[0-9a-f]+\\.scope$`))
    expect(record?.version).toMatch(/^[0-9a-f]{9}$/)
  })

  test('stamps the commit checked out where the job ran, null outside git', async () => {
    const box = runBox()
    const main = path.join(box.root, 'platform')
    const mainHead = repository(main)
    const lane = path.join(box.root, 'lane')
    git(main, 'worktree', 'add', '-q', '-b', 'lane', lane)
    git(lane, 'commit', '-q', '--allow-empty', '-m', 'lane')
    const laneHead = git(lane, 'rev-parse', 'HEAD')
    mkdirSync(path.join(lane, 'apps', 'tui'), { recursive: true })
    const otherHead = repository(path.join(box.root, 'mesh'))
    const outside = path.join(box.root, 'outside')
    mkdirSync(outside)

    for (const cwd of [main, path.join(lane, 'apps', 'tui'), path.join(box.root, 'mesh'), outside])
      expect((await heavy(box, path.basename(cwd), ['true'], { cwd, machine: true })).code).toBe(0)

    const commits = Object.fromEntries(records(box).map((r) => [r.label, r.commitHash]))
    expect(new Set([mainHead, laneHead, otherHead]).size).toBe(3)
    expect(commits).toEqual({ mesh: otherHead, outside: null, platform: mainHead, tui: laneHead })
  })

  test('stamps the commit the job started on, not one made while it ran', async () => {
    const box = runBox()
    const checkout = path.join(box.root, 'platform')
    const started = repository(checkout)
    const committing = ['git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q']
    await heavy(box, 'commits', [...committing, '--allow-empty', '-m', 'during'], {
      cwd: checkout,
      machine: true,
    })
    expect(git(checkout, 'rev-parse', 'HEAD')).not.toBe(started)
    expect(records(box)[0]).toMatchObject({ commitHash: started, exitCode: 0 })
  })

  test('gives up on a git that hangs and records the job without its checkout', async () => {
    const box = runBox()
    const checkout = path.join(box.root, 'platform')
    repository(checkout)
    const bin = path.join(box.root, 'bin')
    mkdirSync(bin)
    const release = path.join(box.root, 'git-release')
    writeFileSync(path.join(bin, 'git'), `#!/bin/sh\n${until(release)}\n`, { mode: 0o755 })
    const result = await heavy(box, 'slow-git', ['true'], {
      cwd: checkout,
      machine: true,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    })
    expect(result.code).toBe(0)
    expect(records(box)[0]).toMatchObject({ commitHash: null, exitCode: 0, repo: null })
  }, 30_000)

  test('records the job when git is not installed', async () => {
    const box = runBox()
    const checkout = path.join(box.root, 'platform')
    repository(checkout)
    const result = await heavy(box, 'no-git', ['true'], {
      cwd: checkout,
      machine: true,
      env: { ...process.env, PATH: pathWithoutGit(box) },
    })
    expect(result.code).toBe(0)
    expect(records(box)[0]).toMatchObject({
      commitHash: null,
      exitCode: 0,
      repo: null,
      subdir: null,
    })
  }, 30_000)

  test('counts CPU time across the whole job and wall time from launch to exit', async () => {
    const box = runBox()
    await heavy(box, 'spin', spin(600), { machine: true })
    const [record] = records(box)
    expect(record?.cpuUsageUsec).toBeGreaterThanOrEqual(500_000)
    expect(record?.wallMs).toBeGreaterThanOrEqual(600)
    expect(record?.memoryPeakBytes).toBeLessThan(200 * MiB)
  })

  test('exits with the command exit code and records it', async () => {
    const box = runBox()
    const result = await heavy(box, 'fails', ['bash', '-c', 'exit 3'], { machine: true })
    expect(result.code).toBe(3)
    expect(records(box)[0]?.exitCode).toBe(3)
  })

  test('keeps secrets out of the recorded command', async () => {
    const box = runBox()
    await heavy(
      box,
      'secret',
      ['env', 'API_TOKEN=hunter2hunter2', 'true', '--password', 'swordfish'],
      { machine: true },
    )
    const line = readdirSync(box.logs).map((file) =>
      readFileSync(path.join(box.logs, file), 'utf8'),
    )
    expect(line.join('')).not.toMatch(/hunter2|swordfish/)
    expect(records(box)[0]?.command).toEqual([
      'env',
      'API_TOKEN=<redacted>',
      'true',
      '--password',
      '<redacted>',
    ])
  })

  test('stops the job and still records it when the wrapper is terminated', async () => {
    const box = runBox()
    const job = start(box, 'stopped', ['bash', '-c', 'echo started; exec sleep 30'], {
      machine: true,
    })
    await expect.poll(job.stdout, { timeout: 10_000 }).toContain('started')
    job.child.kill('SIGTERM')
    const result = await job.done
    expect(result.code).toBe(143)
    const [record] = records(box)
    expect(record).toMatchObject({ exitCode: 143, label: 'stopped' })
    expect(record?.memoryPeakBytes).toBeGreaterThan(0)
    expect(runningEntries(box)).toEqual([])
  })

  test('stops processes the command left running before it records and leaves the running set', async () => {
    const box = runBox()
    const job = start(box, 'forks', ['bash', '-c', 'sleep 30 & echo $!'], { machine: true })
    const result = await job.done
    expect(result.code).toBe(0)
    const orphan = Number(job.stdout().trim())
    expect(alive(orphan)).toBe(false)
    const [record] = records(box)
    expect(record).toMatchObject({ exitCode: 0, label: 'forks', leftoverProcesses: 1 })
    expect(unitActive(record!.unit)).toBe(false)
    expect(runningEntries(box)).toEqual([])
  })

  test('counts the memory of a leftover process in the job', async () => {
    const box = runBox()
    const ready = path.join(box.root, 'allocated')
    const hold = `const b = Buffer.alloc(150 * 2 ** 20, 1); await Bun.write(${JSON.stringify(ready)}, "ready"); setInterval(() => b.at(0), 1000)`
    await heavy(box, 'forked-alloc', ['bash', '-c', `bun -e '${hold}' & ${until(ready)}`], {
      machine: true,
    })
    const [record] = records(box)
    expect(record?.memoryPeakBytes).toBeGreaterThanOrEqual(150 * MiB)
    expect(record?.leftoverProcesses).toBe(1)
  })

  test('a SIGINT sent to the wrapper PID stops the job and records it', async () => {
    const box = runBox()
    const job = start(box, 'int-pid', ['bash', '-c', 'echo started; exec sleep 30'], {
      machine: true,
    })
    await expect.poll(job.stdout, { timeout: 10_000 }).toContain('started')
    job.child.kill('SIGINT')
    const result = await job.done
    expect(result.code).toBe(130)
    expect(records(box)[0]).toMatchObject({ exitCode: 130, label: 'int-pid' })
  })

  test('Ctrl-C to the whole foreground process group stops the job and records it', async () => {
    const box = runBox()
    const job = start(box, 'int-group', ['bash', '-c', 'echo started; exec sleep 30'], {
      detached: true,
      machine: true,
    })
    await expect.poll(job.stdout, { timeout: 10_000 }).toContain('started')
    process.kill(-job.child.pid!, 'SIGINT')
    const result = await job.done
    expect(result.code).toBe(130)
    expect(records(box)[0]).toMatchObject({ exitCode: 130, label: 'int-group' })
  })

  test('a settings read failure is reported and the command exit status still wins', async () => {
    const box = runBox()
    mkdirSync(path.join(box.home, 'settings.json'))
    const result = await heavy(box, 'no-settings', ['true'], { logDir: false, machine: true })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('using the default developer.heavyJobClasses')
    expect(result.stderr).toContain('record was not written')
  })

  test('waits while another process holds all three slot locks, then runs', async () => {
    const box = runBox()
    const slot = (n: number) => path.join(box.state, `slot${n}.lock`)
    for (const n of [1, 2, 3]) writeFileSync(slot(n), '', { flag: 'a' })
    const ready = path.join(box.root, 'locked')
    const release = path.join(box.root, 'release')
    const hold = startExternal(box, [
      'flock',
      slot(1),
      'flock',
      slot(2),
      'flock',
      slot(3),
      'bash',
      '-c',
      `touch ${ready}; ${until(release)}`,
    ])
    const released = new Promise((resolve) => hold.on('close', resolve))
    await expect.poll(() => existsSync(ready), { timeout: 10_000 }).toBe(true)
    const queued = start(box, 'queued', ['true'], { machine: true })
    await expect.poll(queued.stderr, { timeout: 10_000 }).toContain('quiet hold by another tool')
    writeFileSync(release, '')
    const result = await queued.done
    await released
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('quiet hold by another tool')
  }, 20_000)

  test('status lists a running job with its class and estimate', async () => {
    const box = runBox()
    const release = path.join(box.root, 'release')
    const job = start(box, 'listed', ['bash', '-c', `echo started; ${until(release)}`], {
      jobClass: 'light',
      machine: true,
    })
    await expect.poll(job.stdout, { timeout: 10_000 }).toContain('started')
    const status = spawnSync('bun', [
      path.join(import.meta.dirname, 'status.ts'),
      '--state-dir',
      box.state,
      '--slice-root',
      box.sliceRoot,
    ])
    expect(status.stdout.toString()).toMatch(
      /running: 1\n {2}listed \(light, \d+ MiB\) \d+s pid=\d+ cwd=\S+ using \d+ MiB/,
    )
    writeFileSync(release, '')
    await job.done
  })
})

function runningEntries(box: Box) {
  const dir = path.join(box.state, 'jobs')
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : []
}

test('sandbox cleanup stops an external gated process before removing its files', async () => {
  const box = sandbox()
  const ready = path.join(box.root, 'ready')
  const release = path.join(box.root, 'release')
  const child = startExternal(box, ['bash', '-c', `echo $$ > ${ready}; ${until(release)}`])
  const ended = new Promise((resolve) => child.on('close', resolve))
  await expect
    .poll(() => (existsSync(ready) ? readFileSync(ready, 'utf8').trim() : ''), { timeout: 10_000 })
    .toMatch(/^\d+$/)
  const pid = Number(readFileSync(ready, 'utf8').trim())
  expect(alive(pid)).toBe(true)
  await removeSandboxes()
  await ended
  expect(alive(pid)).toBe(false)
  expect(child.signalCode).toBe('SIGKILL')
  expect(existsSync(box.root)).toBe(false)
})

test('a Pi job waits only for the Pi lane, never for this machine', async () => {
  const box = sandbox()
  const lock = (name: string) => path.join(box.state, name)
  const held = ['pi.lock', 'slot1.lock', 'slot2.lock', 'slot3.lock'].map((name) =>
    tryLock(lock(name))!,
  )
  const child = spawn(
    process.execPath,
    [
      RUN,
      '--state-dir',
      box.state,
      '--slice-root',
      box.sliceRoot,
      '--settings-home',
      box.home,
      '--host',
      'pi',
      'pi-wait',
      '--',
      'true',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  let stderr = ''
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const exited = new Promise((resolve) => child.on('close', resolve))
  await expect.poll(() => stderr, { timeout: 10_000 }).toContain('the Pi lane is busy')
  child.kill('SIGTERM')
  await exited
  for (const fd of held) unlock(fd)
  expect(stderr).not.toMatch(/slot\d\.lock|memory/)
  expect(existsSync(path.join(box.state, 'queue'))).toBe(false)
})

test('refuses --max-wall without --host pi, and a ceiling that is not whole seconds', () => {
  const label = 'ceiling-check'
  const wrapper = (flags: readonly string[]) =>
    spawnSync(process.execPath, [RUN, ...flags, label, '--', 'true'], { encoding: 'utf8' })
  const local = wrapper(['--max-wall', '60'])
  expect(local.status).toBe(2)
  expect(local.stderr).toContain('--max-wall applies to --host pi')
  const fraction = wrapper(['--host', 'pi', '--max-wall', '1.5'])
  expect(fraction.status).toBe(2)
  expect(fraction.stderr).toContain('positive whole number of seconds')
})
