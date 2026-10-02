import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { bootSeconds, liveSlices, sliceMemory, sliceState } from './admission'
import { reapSlice, stopTimeoutSeconds } from './job'
import { sliceRootFor, tryLock, unlock } from './lock'
import { enqueue, live, release } from './queue'
import {
  alive,
  type Box,
  firstDecision,
  heavy,
  recordOf,
  removeSandboxes,
  sandbox,
  start,
  unitActive,
  until,
  userScopes,
  writeMachine,
  writeSettings,
} from './sandbox'

afterEach(() => {
  vi.restoreAllMocks()
  removeSandboxes()
})

const SLOTS = ['slot1.lock', 'slot2.lock', 'slot3.lock']
const light = { ceilingMiB: 1024, estimateMiB: 512 }
const classes = { bench: light, browser: light, build: light, light, suite: light }

function lifecycleBox(availableMiB: number, graceSeconds = 10) {
  const box = sandbox()
  writeMachine(box, { availableMiB })
  writeSettings(box, {
    'developer.heavyJobClasses': classes,
    'developer.heavyJobMemoryReserveMiB': 0,
    'developer.heavyJobStopGraceSeconds': graceSeconds,
  })
  return box
}

function exclusiveSlotFree(box: Box) {
  const fds = SLOTS.map((slot) => tryLock(path.join(box.state, slot)))
  for (const fd of fds) if (fd !== null) unlock(fd)
  return fds.every((fd) => fd !== null)
}

function dropIns(box: Box) {
  const dir = `/run/user/${process.getuid?.()}/systemd/user.control`
  return readdirSync(dir).filter((name) => name.startsWith(`${box.sliceRoot}-`))
}

const job = {
  cwd: '/',
  estimateBytes: 1,
  jobClass: 'light',
  label: 'x',
  pid: process.pid,
  quiet: false,
  sliceRoot: 'heavytqueue',
}

describe('the queue', () => {
  test('keeps arrival order when the clock ties or runs backward', () => {
    const box = sandbox()
    const now = vi.spyOn(Date, 'now')
    const ids = ['a', 'b', 'c', 'd'].map((letter) => letter.repeat(12))
    const held = ids.map((id, index) => {
      now.mockReturnValue([5_000, 5_000, 1_000, 1_000][index]!)
      return enqueue(box.state, { ...job, id, since: '' })
    })
    expect(live(box.state, 'queue').map((entry) => entry.id)).toEqual(ids)
    for (const entry of held) release(entry)
  })

  test('a scan never fails on an entry its owner releases mid-read', async () => {
    const box = sandbox()
    mkdirSync(path.join(box.state, 'queue'), { recursive: true })
    const churn = spawn(
      process.execPath,
      [
        '-e',
        `const { enqueue, release } = await import(${JSON.stringify(path.join(import.meta.dirname, 'queue.ts'))})
         const end = Date.now() + 3000
         let n = 0
         while (Date.now() < end) release(enqueue(${JSON.stringify(box.state)}, { id: (n++).toString(16).padStart(12, '0'), cwd: '/', estimateBytes: 1, jobClass: 'light', label: 'c', pid: process.pid, quiet: false, since: '' }))`,
      ],
      { stdio: 'ignore' },
    )
    const exited = new Promise((resolve) => churn.on('close', resolve))
    let scans = 0
    const errors: unknown[] = []
    const end = Date.now() + 2_500
    while (Date.now() < end) {
      try {
        live(box.state, 'queue')
        scans += 1
      } catch (error) {
        errors.push(error)
      }
    }
    await exited
    expect(errors).toEqual([])
    expect(scans).toBeGreaterThan(100)
  }, 20_000)
})

const RUN = path.join(import.meta.dirname, 'run.ts')

/**
 * A stand-in for production: a private state directory, a private root named as production's,
 * and a live process in a slice under that root. Every wrapper these tests start names the
 * stand-in as production, so a broken guard can only reach the stand-in, never the real root.
 */
async function standInProduction() {
  const state = sandbox().state
  const root = `heavytprod${randomBytes(4).toString('hex')}`
  const canary = spawn(
    'systemd-run',
    [
      '--user',
      '--scope',
      '--quiet',
      '--expand-environment=no',
      `--slice=${root}-live.slice`,
      'bash',
      '-c',
      'echo $$; exec sleep 60',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  let out = ''
  canary.stdout.on('data', (chunk) => (out += chunk))
  await expect.poll(() => out, { timeout: 10_000 }).toMatch(/^\d+\n/)
  return {
    args: ['--production-state-dir', state, '--production-slice-root', root],
    pid: Number(out.trim()),
    root,
    stop: () => {
      canary.kill('SIGTERM')
      spawnSync('systemctl', ['--user', 'stop', `${root}.slice`])
    },
  }
}

function wrapper(args: readonly string[], cwd?: string) {
  return spawnSync(process.execPath, [RUN, ...args], { cwd, encoding: 'utf8' })
}

describe.skipIf(!userScopes)('slice roots', () => {
  test('a wrapper stops only ownerless slices under its own root, never one beside it', async () => {
    const production = await standInProduction()
    try {
      const box = lifecycleBox(65536)
      expect((await heavy(box, 'own-root', ['true'], { jobClass: 'light' })).code).toBe(0)
      const unrooted = sandbox()
      const result = wrapper([
        ...production.args,
        '--state-dir',
        unrooted.state,
        '--log-dir',
        unrooted.logs,
        'no-root',
        '--',
        'true',
      ])
      expect(result.status).toBe(0)
      expect(recordOf(unrooted, 'no-root')?.slice).toMatch(/^heavys[0-9a-f]{10}-[0-9a-f]+\.slice$/)
      expect(alive(production.pid)).toBe(true)
      expect(liveSlices(production.root).map((slice) => slice.slice)).toEqual([
        `${production.root}-live.slice`,
      ])
      spawnSync('systemctl', ['--user', 'stop', `${sliceRootFor(unrooted.state)}.slice`])
    } finally {
      production.stop()
    }
  }, 40_000)

  test("production's root is refused with any other state directory", async () => {
    const production = await standInProduction()
    try {
      const box = sandbox()
      const result = wrapper([
        ...production.args,
        '--state-dir',
        box.state,
        '--slice-root',
        production.root,
        'refused',
        '--',
        'true',
      ])
      expect(result.status).toBe(2)
      expect(result.stderr).toContain(
        `--slice-root ${production.root} belongs to the state directory`,
      )
      expect(existsSync(path.join(box.state, 'queue'))).toBe(false)
      expect(alive(production.pid)).toBe(true)
    } finally {
      production.stop()
    }
  }, 30_000)

  test('every path to one state directory owns the same slices', async () => {
    const production = await standInProduction()
    const box = sandbox()
    const alias = path.join(box.root, 'alias')
    symlinkSync(box.state, alias)
    try {
      expect(sliceRootFor(alias)).toBe(sliceRootFor(box.state))
      const viaAlias = spawn(
        process.execPath,
        [
          RUN,
          ...production.args,
          '--state-dir',
          alias,
          '--log-dir',
          box.logs,
          'via-alias',
          '--',
          'bash',
          '-c',
          'echo $$; exec sleep 60',
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      )
      let out = ''
      viaAlias.stdout.on('data', (chunk) => (out += chunk))
      await expect.poll(() => out, { timeout: 10_000 }).toMatch(/^\d+\n/)
      const sleeper = Number(out.trim())
      const killed = new Promise((resolve) => viaAlias.on('exit', resolve))
      viaAlias.kill('SIGKILL')
      await killed
      const physical = wrapper([
        ...production.args,
        '--state-dir',
        box.state,
        '--log-dir',
        box.logs,
        'physical',
        '--',
        'true',
      ])
      expect(physical.status).toBe(0)
      expect(physical.stderr).toMatch(
        /stopping heavys[0-9a-f]{10}-[0-9a-f]+\.slice: its wrapper is gone/,
      )
      expect(alive(sleeper)).toBe(false)
      expect(alive(production.pid)).toBe(true)
    } finally {
      spawnSync('systemctl', ['--user', 'stop', `${sliceRootFor(box.state)}.slice`])
      production.stop()
    }
  }, 40_000)

  test('the reaper refuses a slice outside the root it was given', () => {
    expect(() => reapSlice('heavytmine', 'heavy-0123abcd.slice')).toThrow(
      'outside the slice root heavytmine',
    )
  })
})

describe.skipIf(!userScopes)('job lifecycle', () => {
  test('a scan never fails on a slice that is removed mid-read', async () => {
    const box = sandbox()
    const churn = spawn(
      'bash',
      [
        '-c',
        `end=$((SECONDS + 4)); i=0; while [ $SECONDS -lt $end ]; do systemd-run --user --scope --quiet --slice=${box.sliceRoot}-c$i.slice true; systemctl --user stop ${box.sliceRoot}-c$i.slice; i=$((i + 1)); done`,
      ],
      { stdio: 'ignore' },
    )
    const exited = new Promise((resolve) => churn.on('close', resolve))
    let seen = 0
    const errors: unknown[] = []
    while (churn.exitCode === null) {
      try {
        for (const slice of liveSlices(box.sliceRoot)) {
          sliceMemory(box.sliceRoot, slice.slice)
          seen += 1
        }
      } catch (error) {
        errors.push(error)
      }
      await new Promise((resolve) => setImmediate(resolve))
    }
    await exited
    expect(errors).toEqual([])
    expect(seen).toBeGreaterThan(0)
  }, 30_000)

  test('a wrapper killed mid-job keeps its locks held until the next admission stops the orphan', async () => {
    const box = lifecycleBox(768)
    const first = start(box, 'orphaned', ['bash', '-c', 'echo $$; exec sleep 60'], {
      jobClass: 'light',
      machine: true,
    })
    await expect.poll(first.stdout, { timeout: 10_000 }).toMatch(/^\d+\n/)
    const sleeper = Number(first.stdout().trim())
    const killed = new Promise((resolve) => first.child.on('exit', resolve))
    first.child.kill('SIGKILL')
    await killed
    expect(alive(sleeper)).toBe(true)
    expect(exclusiveSlotFree(box)).toBe(false)

    const next = await heavy(box, 'next', ['true'], { jobClass: 'light', machine: true })
    expect(next.code).toBe(0)
    expect(next.stderr).toMatch(/stopping \S+\.slice: its wrapper is gone/)
    expect(next.stderr).toMatch(/'next' is waiting: memory: -?\d+ MiB free after 1 running job/)
    expect(alive(sleeper)).toBe(false)
    expect(exclusiveSlotFree(box)).toBe(true)
    expect(liveSlices(box.sliceRoot)).toEqual([])
  }, 40_000)

  test('a job that ignores SIGTERM is killed after the grace and leaves nothing held', async () => {
    const box = lifecycleBox(65536, 1)
    const stubborn = start(
      box,
      'stubborn',
      ['bash', '-c', 'trap "" TERM; echo started; exec sleep 60'],
      {
        jobClass: 'light',
      },
    )
    await expect.poll(stubborn.stdout, { timeout: 10_000 }).toContain('started')
    const stoppedAt = Date.now()
    stubborn.child.kill('SIGTERM')
    const result = await stubborn.done
    expect(Date.now() - stoppedAt).toBeLessThan(8_000)
    expect(result.code).toBe(137)
    expect(recordOf(box, 'stubborn')).toMatchObject({ exitCode: 137 })
    expect(unitActive(recordOf(box, 'stubborn')!.slice!)).toBe(false)
    expect(exclusiveSlotFree(box)).toBe(true)
  }, 30_000)

  test('a launch that fails leaves no ceiling, entry or lock behind', async () => {
    const box = lifecycleBox(65536)
    const gone = path.join(box.root, 'gone')
    mkdirSync(gone)
    writeFileSync(path.join(box.state, 'drain.request'), `pid=${process.pid} since=now holder=test`)
    const doomed = spawn(
      process.execPath,
      [
        path.join(import.meta.dirname, 'run.ts'),
        '--state-dir',
        box.state,
        '--settings-home',
        box.home,
        '--slice-root',
        box.sliceRoot,
        '--class',
        'light',
        'doomed',
        '--',
        'true',
      ],
      { cwd: gone, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    doomed.stderr.on('data', (chunk) => (stderr += chunk))
    const exited = new Promise<number | null>((resolve) => doomed.on('close', resolve))
    await expect.poll(() => stderr, { timeout: 10_000 }).toContain('draining for')
    rmSync(gone, { recursive: true })
    rmSync(path.join(box.state, 'drain.request'))
    expect(await exited).toBe(2)
    expect(dropIns(box)).toEqual([])
    expect(
      readdirSync(path.join(box.state, 'jobs')).filter((name) => name.endsWith('.json')),
    ).toEqual([])
    expect(exclusiveSlotFree(box)).toBe(true)
  }, 30_000)

  test('a drain request from a live process holds new jobs until it is withdrawn', async () => {
    const box = lifecycleBox(65536)
    const request = path.join(box.state, 'drain.request')
    writeFileSync(
      request,
      `pid=${process.pid} since=${new Date().toISOString()} holder=quiet-bench`,
    )
    const held = start(box, 'held', ['true'], { jobClass: 'light' })
    await expect.poll(held.stderr, { timeout: 10_000 }).toContain('draining for pid=')
    expect(held.stderr()).toContain('holder=quiet-bench')
    rmSync(request)
    expect((await held.done).code).toBe(0)
  }, 30_000)

  test('a drain request from a dead process is ignored', async () => {
    const box = lifecycleBox(65536)
    const dead = spawnSync('bash', ['-c', 'echo $$']).stdout.toString().trim()
    writeFileSync(path.join(box.state, 'drain.request'), `pid=${dead} since=then holder=gone`)
    const result = await heavy(box, 'free', ['true'], { jobClass: 'light' })
    expect(result.code).toBe(0)
    expect(result.stderr).not.toContain('draining')
    expect(existsSync(path.join(box.state, 'drain.request'))).toBe(true)
  }, 30_000)
})

describe.skipIf(!userScopes)('two slice roots sharing one state directory', () => {
  test('charges a running job by its own slice root', async () => {
    // 768 MiB free: the other root's job holds 400 MiB of its 512 MiB estimate.
    const box = lifecycleBox(768)
    const other = sandbox().sliceRoot
    const release = path.join(box.root, 'release')
    const holding = `bun -e 'const b = Buffer.alloc(400 * 2 ** 20, 1); setInterval(() => b.at(0), 1000)'`
    const first = start(
      box,
      'first',
      ['bash', '-c', `${holding} & echo started; ${until(release)}; kill $!`],
      { jobClass: 'light', machine: true, sliceRoot: other },
    )
    await expect.poll(first.stdout, { timeout: 10_000 }).toContain('started')
    await expect
      .poll(() => liveSlices(other).map((slice) => sliceMemory(other, slice.slice) ?? 0)[0] ?? 0, {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(400 * 2 ** 20)
    const second = start(box, 'second', ['true'], { jobClass: 'light', machine: true })
    expect(await firstDecision(second)).toBe('started')
    writeFileSync(release, '')
    await Promise.all([first.done, second.done])
  }, 30_000)

  test("reaps an orphan its state directory names on another root, and no other root's slice", async () => {
    const box = lifecycleBox(65536)
    const other = sandbox().sliceRoot
    // Another state directory with its own root: nothing in `box` attributes its slices.
    const stranger = sandbox()
    const orphan = async (owner: Box, label: string, sliceRoot?: string) => {
      const wrapper = start(owner, label, ['bash', '-c', 'echo $$; exec sleep 60'], {
        jobClass: 'light',
        sliceRoot,
      })
      await expect.poll(wrapper.stdout, { timeout: 10_000 }).toMatch(/^\d+\n/)
      // The job keeps the wrapper's stdout open, so its exit is what to wait for.
      const killed = new Promise((resolve) => wrapper.child.on('exit', resolve))
      wrapper.child.kill('SIGKILL')
      await killed
      return Number(wrapper.stdout().trim())
    }
    const named = await orphan(box, 'named', other)
    const unnamed = await orphan(stranger, 'unnamed')

    const next = await heavy(box, 'next', ['true'], { jobClass: 'light' })
    expect(next.code).toBe(0)
    expect(next.stderr).toMatch(
      new RegExp(`stopping ${other}-[0-9a-f]+\\.slice: its wrapper is gone`),
    )
    expect(alive(named)).toBe(false)
    expect(alive(unnamed)).toBe(true)
    expect(liveSlices(other)).toEqual([])
    expect(liveSlices(stranger.sliceRoot)).toHaveLength(1)
  }, 40_000)
})

describe.skipIf(!userScopes)('reaping a dead entry on another root', () => {
  const SYSTEMCTL = spawnSync('sh', ['-c', 'command -v systemctl'], {
    encoding: 'utf8',
  }).stdout.trim()
  const SYSTEMD_RUN = spawnSync('sh', ['-c', 'command -v systemd-run'], {
    encoding: 'utf8',
  }).stdout.trim()
  const sleeper = (pidFile: string) => ['bash', '-c', `echo $$ > ${pidFile}; exec sleep 60`]
  const pidIn = (file: string) => Number(readFileSync(file, 'utf8').trim())
  const readlinkSafe = (link: string) => {
    try {
      return readlinkSync(link)
    } catch {
      return ''
    }
  }
  const shim = (box: Box, name: string, body: string) => {
    const bin = path.join(box.root, `bin-${name}`)
    mkdirSync(bin)
    writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 })
    return { ...process.env, PATH: `${bin}:${process.env.PATH}` }
  }
  // Kills a wrapper; its job keeps the wrapper's stdout open, so its exit is what to wait for.
  const killWrapper = async (wrapper: ReturnType<typeof start>) => {
    const exited = new Promise((resolve) => wrapper.child.on('exit', resolve))
    wrapper.child.kill('SIGKILL')
    await exited
  }

  test('never stops a slice a live entry owns, whatever a stale copy of that entry says', async () => {
    const box = lifecycleBox(65536)
    const other = sandbox().sliceRoot
    const pidFile = path.join(box.root, 'pid')
    const owner = start(box, 'owner', sleeper(pidFile), {
      jobClass: 'light',
      machine: true,
      sliceRoot: other,
    })
    await expect.poll(() => existsSync(pidFile), { timeout: 10_000 }).toBe(true)
    const [entry] = readdirSync(path.join(box.state, 'jobs')).filter((name) =>
      name.endsWith('.json'),
    )
    copyFileSync(
      path.join(box.state, 'jobs', entry!),
      path.join(box.state, 'jobs', 'stale-renamed.json'),
    )

    const next = await heavy(box, 'next', ['true'], { jobClass: 'light', machine: true })
    expect(next.stderr).not.toContain('stopping')
    expect(alive(pidIn(pidFile))).toBe(true)
    owner.child.kill('SIGTERM')
    await owner.done
  }, 40_000)

  test('never stops a slice a dead entry names outside the slice-root grammar', async () => {
    const box = lifecycleBox(65536)
    const root = `HeavyT${randomBytes(4).toString('hex')}`
    const id = randomBytes(6).toString('hex')
    const canary = spawn(
      SYSTEMD_RUN,
      ['--user', '--scope', '--quiet', `--slice=${root}-${id}.slice`, 'sleep', '60'],
      {
        stdio: 'ignore',
      },
    )
    try {
      await expect.poll(() => liveSlices(root).length, { timeout: 10_000 }).toBe(1)
      mkdirSync(path.join(box.state, 'jobs'), { recursive: true })
      writeFileSync(
        path.join(box.state, 'jobs', `${id}.json`),
        JSON.stringify({ ...job, id, sliceRoot: root }),
      )

      const next = await heavy(box, 'next', ['true'], { jobClass: 'light' })
      expect(next.stderr).not.toContain('stopping')
      expect(alive(canary.pid!)).toBe(true)
      expect(existsSync(path.join(box.state, 'jobs', `${id}.json`))).toBe(false)
    } finally {
      canary.kill('SIGKILL')
      spawnSync(SYSTEMCTL, ['--user', 'stop', `${root}.slice`])
    }
  }, 40_000)

  test('keeps a dead entry, and its charge, until its slice has really stopped', async () => {
    const box = lifecycleBox(65536)
    const other = sandbox().sliceRoot
    const pidFile = path.join(box.root, 'pid')
    const orphaned = start(box, 'orphaned', sleeper(pidFile), {
      jobClass: 'light',
      machine: true,
      sliceRoot: other,
    })
    await expect.poll(() => existsSync(pidFile), { timeout: 10_000 }).toBe(true)
    await killWrapper(orphaned)
    const entries = () =>
      readdirSync(path.join(box.state, 'jobs')).filter((n) => n.endsWith('.json'))
    expect(entries()).toHaveLength(1)

    // A systemctl that fails every stop of the orphan's slice.
    const failing = shim(
      box,
      'systemctl',
      `case "$2 $*" in kill*${other}-*|stop*${other}-*|revert*${other}-*) exit 1;; esac\nexec ${SYSTEMCTL} "$@"`,
    )
    const first = await heavy(box, 'first', ['true'], {
      env: failing,
      jobClass: 'light',
      machine: true,
    })
    expect(first.stderr).toContain(`stopping ${other}-`)
    expect(alive(pidIn(pidFile))).toBe(true)
    expect(entries()).toHaveLength(1)

    const second = await heavy(box, 'second', ['true'], { jobClass: 'light', machine: true })
    expect(second.code).toBe(0)
    expect(alive(pidIn(pidFile))).toBe(false)
    expect(entries()).toEqual([])
  }, 60_000)

  test('no startup file of the shim can carry the entry lock past it', async () => {
    const box = lifecycleBox(65536)
    const other = sandbox().sliceRoot
    const helpers = path.join(box.root, 'helpers')
    const bashEnv = path.join(box.root, 'bash-env')
    writeFileSync(bashEnv, `sleep 60 & echo $! >> ${helpers}\n`)
    const pidFile = path.join(box.root, 'pid')
    const orphaned = start(box, 'orphaned', ['bash', '-c', `echo $$ > ${pidFile}; exec sleep 60`], {
      env: { ...process.env, BASH_ENV: bashEnv },
      jobClass: 'light',
      sliceRoot: other,
    })
    await expect.poll(() => existsSync(pidFile), { timeout: 10_000 }).toBe(true)
    const entry = readdirSync(path.join(box.state, 'jobs')).find((name) => name.endsWith('.json'))!
    const entryFile = realpathSync(path.join(box.state, 'jobs', entry))
    // The job's own bash still reads BASH_ENV; no helper started anywhere holds the entry lock.
    const started = readFileSync(helpers, 'utf8').trim().split('\n').map(Number)
    expect(started.length).toBeGreaterThan(0)
    for (const pid of started) {
      const fds = readdirSync(`/proc/${pid}/fd`).map((fd) => readlinkSafe(`/proc/${pid}/fd/${fd}`))
      expect(fds).not.toContain(entryFile)
    }
    await killWrapper(orphaned)

    const next = await heavy(box, 'next', ['true'], { jobClass: 'light' })
    expect(next.stderr).toContain(`stopping ${other}-`)
    expect(alive(pidIn(pidFile))).toBe(false)
  }, 40_000)

  test('keeps a dead entry whose empty slice failed to stop', async () => {
    const box = lifecycleBox(65536)
    const other = sandbox().sliceRoot
    const id = randomBytes(6).toString('hex')
    const slice = `${other}-${id}.slice`
    const sleeper = spawn(
      SYSTEMD_RUN,
      ['--user', '--scope', '--quiet', `--slice=${slice}`, 'sleep', '60'],
      {
        stdio: 'ignore',
      },
    )
    await expect.poll(() => sliceState(other, slice), { timeout: 10_000 }).toBe('running')
    sleeper.kill('SIGKILL')
    await expect.poll(() => sliceState(other, slice), { timeout: 10_000 }).toBe('empty')
    const entryFile = path.join(box.state, 'jobs', `${id}.json`)
    mkdirSync(path.dirname(entryFile), { recursive: true })
    writeFileSync(entryFile, JSON.stringify({ ...job, id, sliceRoot: other }))

    const failing = shim(
      box,
      'systemctl',
      `case "$2 $*" in stop*${slice}*|revert*${slice}*) exit 1;; esac\nexec ${SYSTEMCTL} "$@"`,
    )
    expect((await heavy(box, 'failing', ['true'], { env: failing, jobClass: 'light' })).code).toBe(
      0,
    )
    expect(existsSync(entryFile)).toBe(true)

    expect((await heavy(box, 'next', ['true'], { jobClass: 'light' })).code).toBe(0)
    expect(existsSync(entryFile)).toBe(false)
    expect(sliceState(other, slice)).toBe('gone')
  }, 40_000)

  test('warns once when an orphan will not stop, errors once past the stop timeout, then retries quietly', async () => {
    const box = lifecycleBox(65536, 1)
    const other = sandbox().sliceRoot
    const pidFile = path.join(box.root, 'pid')
    const orphaned = start(box, 'orphaned', sleeper(pidFile), {
      jobClass: 'light',
      machine: true,
      sliceRoot: other,
    })
    await expect.poll(() => existsSync(pidFile), { timeout: 10_000 }).toBe(true)
    await killWrapper(orphaned)
    const failing = shim(
      box,
      'systemctl',
      `case "$2 $*" in kill*${other}-*|stop*${other}-*|revert*${other}-*) exit 1;; esac\nexec ${SYSTEMCTL} "$@"`,
    )
    const pass = async (label: string) => {
      const result = await heavy(box, label, ['true'], {
        env: failing,
        jobClass: 'light',
        machine: true,
      })
      expect(result.code).toBe(0)
      return result.stderr
    }

    const first = await pass('first')
    expect(first).toContain(`stopping ${other}-`)
    expect(first).toMatch(/warn: \S+ is still running/)
    expect(first.match(/warn:/g)).toHaveLength(1)
    expect(first).not.toMatch(/error:/)
    const markers = path.join(box.state, 'reaping')
    const slices = readdirSync(markers)
    expect(slices).toHaveLength(1)
    const [slice] = slices
    expect(slice).toMatch(new RegExp(`^${other}-[0-9a-f]+\\.slice$`))
    const marker = path.join(markers, slice!)
    expect(readFileSync(marker, 'utf8')).toMatch(/^\d+(?:\.\d+)? warned$/)
    // Keep this pass before the deadline even if the runner pauses during admission.
    const beforeTimeout = `${bootSeconds() + 120} warned`
    writeFileSync(marker, beforeTimeout)
    const second = await pass('second')
    expect(second).not.toContain('stopping')
    expect(second).not.toMatch(/warn:|error:/)
    expect(readFileSync(marker, 'utf8')).toBe(beforeTimeout)
    // Age the persisted series past its deadline without waiting on a wall-clock timer.
    const since = bootSeconds() - stopTimeoutSeconds(1) - 1
    writeFileSync(marker, `${since} warned`)
    const third = await pass('third')
    expect(third).toMatch(new RegExp(`error: ${other}-[0-9a-f]+\\.slice .*systemctl --user stop`))
    expect(third.match(/error:/g)).toHaveLength(1)
    expect(third).not.toMatch(/stopping|warn:/)
    expect(readFileSync(marker, 'utf8')).toBe(`${since} error`)
    const fourth = await pass('fourth')
    expect(fourth).not.toMatch(/stopping|warn:|error:/)
    expect(readFileSync(marker, 'utf8')).toBe(`${since} error`)
    expect(alive(pidIn(pidFile))).toBe(true)

    const healthy = await heavy(box, 'healthy', ['true'], { jobClass: 'light', machine: true })
    expect(healthy.code).toBe(0)
    expect(existsSync(marker)).toBe(false)
    expect(alive(pidIn(pidFile))).toBe(false)
    expect(readdirSync(path.join(box.state, 'jobs')).filter((n) => !n.startsWith('.'))).toEqual([])
  }, 60_000)

  test('an unreadable entry is dropped without blocking admission or naming a slice', async () => {
    const box = lifecycleBox(65536)
    const jobs = path.join(box.state, 'jobs')
    mkdirSync(jobs, { recursive: true })
    writeFileSync(path.join(jobs, 'stale-renamed.json'), '{"id": "0123')
    writeFileSync(path.join(jobs, `${randomBytes(6).toString('hex')}.json`), '{"id": "0123')

    const next = await heavy(box, 'next', ['true'], { jobClass: 'light' })
    expect(next.code).toBe(0)
    expect(next.stderr).not.toContain('stopping')
    expect(readdirSync(jobs).filter((name) => name.endsWith('.json'))).toEqual([])
  }, 40_000)

  test('treats a job whose launcher has not reached its slice yet as running', async () => {
    const box = lifecycleBox(65536)
    const other = sandbox().sliceRoot
    const blocked = path.join(box.root, 'blocked')
    const go = path.join(box.root, 'go')
    const pidFile = path.join(box.root, 'pid')
    // A systemd-run that pauses before it makes the scope.
    const paused = shim(
      box,
      'systemd-run',
      `: > ${blocked}\n${until(go)}\nexec ${SYSTEMD_RUN} "$@"`,
    )
    const launching = start(box, 'launching', sleeper(pidFile), {
      env: paused,
      jobClass: 'light',
      sliceRoot: other,
    })
    await expect.poll(() => existsSync(blocked), { timeout: 10_000 }).toBe(true)
    await killWrapper(launching)

    const during = await heavy(box, 'during', ['true'], { jobClass: 'light' })
    expect(during.code).toBe(0)
    writeFileSync(go, '')
    await expect.poll(() => existsSync(pidFile), { timeout: 10_000 }).toBe(true)
    await expect.poll(() => liveSlices(other).length, { timeout: 10_000 }).toBe(1)

    const after = await heavy(box, 'after', ['true'], { jobClass: 'light' })
    expect(after.stderr).toContain(`stopping ${other}-`)
    expect(alive(pidIn(pidFile))).toBe(false)
    expect(liveSlices(other)).toEqual([])
  }, 60_000)
})
