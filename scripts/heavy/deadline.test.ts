import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { live } from './queue'
import { sliceState } from './admission'
import { removeSlice } from './job'
import { tryLock, unlock } from './lock'
import {
  alive,
  removeSandboxes,
  sandbox,
  start,
  unitActive,
  userScopes,
  writeMachine,
  writeSettings,
} from './sandbox'

const light = { ceilingMiB: 1024, estimateMiB: 64 }
const NESTED = path.join(import.meta.dirname, 'nested-scope.sh')

const ownedSlices: string[] = []
afterEach(async () => {
  for (const slice of ownedSlices.splice(0)) {
    killSlice(slice)
    removeSlice(slice)
  }
  await removeSandboxes()
})

function ownSlice(root: string, id: string) {
  const slice = `${root}-${id}.slice`
  ownedSlices.push(slice)
  return slice
}

function deadlineBox(seconds = 2) {
  const box = sandbox()
  writeMachine(box, { availableMiB: 65536 })
  writeSettings(box, {
    'developer.heavyJobClasses': {
      bench: light,
      browser: light,
      build: light,
      light,
      suite: light,
    },
    'developer.heavyJobQuietHoldSeconds': seconds,
    'developer.heavyJobStopGraceSeconds': 1,
  })
  return box
}

const pidIn = (file: string) => Number(readFileSync(file, 'utf8').trim())
const systemdRun = spawnSync('sh', ['-c', 'command -v systemd-run'], {
  encoding: 'utf8',
}).stdout.trim()
const watchdogOf = (slice: string) => `${slice.slice(0, -'.slice'.length)}_deadline.service`
const serviceState = (service: string) =>
  spawnSync('systemctl', ['--user', 'show', service, '-p', 'LoadState', '--value'], {
    encoding: 'utf8',
  }).stdout.trim()

function launcher(box: ReturnType<typeof sandbox>, body: string) {
  const bin = path.join(box.root, 'bin')
  mkdirSync(bin)
  writeFileSync(path.join(bin, 'systemd-run'), `#!/bin/bash\n${body}\nexec ${systemdRun} "$@"\n`, {
    mode: 0o755,
  })
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` }
}

function slotsFree(box: ReturnType<typeof sandbox>) {
  const fds = [1, 2, 3].map((index) => tryLock(path.join(box.state, `slot${index}.lock`)))
  for (const fd of fds) if (fd !== null) unlock(fd)
  return fds.every((fd) => fd !== null)
}

// A failed assertion must still reap the private sibling, which holds the wrapper's pipes open.
function killSlice(slice: string) {
  spawnSync('systemctl', ['--user', 'kill', '--signal=SIGKILL', slice])
}

describe.skipIf(!userScopes)('whole-slice deadlines (requires user systemd scopes)', () => {
  test('stops TERM-ignoring main and nested siblings while the wrapper is suspended, preserving an unrelated live canary', async () => {
    const box = deadlineBox()
    const stranger = deadlineBox()
    const canaryPid = path.join(stranger.root, 'canary.pid')
    const canary = start(
      stranger,
      'canary',
      ['bash', '-c', 'echo $$ > "$1"; exec sleep 60', '_', canaryPid],
      {
        jobClass: 'light',
        machine: true,
      },
    )
    const mainPid = path.join(box.root, 'main.pid')
    const nestedPid = path.join(box.root, 'nested.pid')
    const owned = start(
      box,
      'deadline',
      [
        'bash',
        '-c',
        'trap "" TERM; bash "$1" --unit="$2" bash -c \'trap "" TERM; echo $$ > "$1"; exec sleep 60\' _ "$3" & until [ -s "$3" ]; do sleep 0.02; done; echo $$ > "$4"; exec sleep 60',
        '_',
        NESTED,
        `${box.sliceRoot}-nested.scope`,
        nestedPid,
        mainPid,
      ],
      { quiet: true, jobClass: 'light', machine: true },
    )
    let slice: string | undefined
    try {
      await expect
        .poll(() => existsSync(mainPid) && existsSync(canaryPid), { timeout: 10_000 })
        .toBe(true)
      const owner = live(box.state, 'jobs').find((entry) => entry.label === 'deadline')!
      slice = ownSlice(box.sliceRoot, owner.id)
      expect(alive(pidIn(mainPid))).toBe(true)
      expect(alive(pidIn(nestedPid))).toBe(true)
      expect(alive(pidIn(canaryPid))).toBe(true)
      const started = performance.now()
      owned.child.kill('SIGSTOP')
      await expect
        .poll(() => readFileSync(`/proc/${owned.child.pid}/status`, 'utf8'), { timeout: 2_000 })
        .toMatch(/^State:\s+T/m)
      await expect
        .poll(() => ({ main: alive(pidIn(mainPid)), nested: alive(pidIn(nestedPid)) }), {
          timeout: 8_000,
        })
        .toEqual({ main: false, nested: false })
      expect(performance.now() - started).toBeLessThan(5_000)
      expect(alive(pidIn(canaryPid))).toBe(true)
      expect(sliceState(box.sliceRoot, slice)).not.toBe('running')
      await expect
        .poll(() => serviceState(watchdogOf(slice!)), { timeout: 2_000 })
        .toBe('not-found')
      console.log(
        JSON.stringify({
          event: 'whole-slice-deadline',
          mainAlive: alive(pidIn(mainPid)),
          nestedAlive: alive(pidIn(nestedPid)),
          canaryAlive: alive(pidIn(canaryPid)),
          elapsedMs: Math.round(performance.now() - started),
        }),
      )
    } finally {
      if (slice) killSlice(slice)
      owned.child.kill('SIGCONT')
      owned.child.kill('SIGTERM')
      canary.child.kill('SIGTERM')
      await Promise.all([owned.done, canary.done])
    }
    expect(unitActive(slice!)).toBe(false)
    expect(slotsFree(box)).toBe(true)
  }, 25_000)

  test('the native service deadline kills the slice even when the watchdog shell is suspended', async () => {
    const box = deadlineBox()
    const marker = path.join(box.root, 'command.pid')
    const owned = start(
      box,
      'native-deadline',
      ['bash', '-c', 'trap "" TERM; echo $$ > "$1"; exec sleep 60', '_', marker],
      { quiet: true, jobClass: 'light', machine: true },
    )
    let slice: string | undefined
    try {
      await expect.poll(() => existsSync(marker), { timeout: 10_000 }).toBe(true)
      const [owner] = live(box.state, 'jobs')
      slice = ownSlice(box.sliceRoot, owner!.id)
      const watchdog = watchdogOf(slice)
      const pid = Number(
        spawnSync('systemctl', ['--user', 'show', watchdog, '-p', 'MainPID', '--value'], {
          encoding: 'utf8',
        }).stdout.trim(),
      )
      expect(pid).toBeGreaterThan(0)
      owned.child.kill('SIGSTOP')
      process.kill(pid, 'SIGSTOP')
      await expect
        .poll(() => readFileSync(`/proc/${pid}/status`, 'utf8'), { timeout: 2_000 })
        .toMatch(/^State:\s+T/m)
      const started = performance.now()
      await expect.poll(() => alive(pidIn(marker)), { timeout: 6_000 }).toBe(false)
      expect(performance.now() - started).toBeLessThan(5_000)
      console.log(
        JSON.stringify({
          event: 'native-watchdog-deadline',
          commandAlive: alive(pidIn(marker)),
          elapsedMs: Math.round(performance.now() - started),
        }),
      )
    } finally {
      if (slice) killSlice(slice)
      owned.child.kill('SIGCONT')
      owned.child.kill('SIGTERM')
      await owned.done
    }
  }, 15_000)

  test.each([0, 1])(
    'refuses execution when watchdog launch returns %s without a ready service',
    async (status) => {
      const box = deadlineBox(20)
      const marker = path.join(box.root, 'command-ran')
      const env = launcher(box, `case " $* " in *" --collect "*) exit ${status};; esac`)
      const owned = start(box, 'unarmed', ['touch', marker], {
        env,
        quiet: true,
        jobClass: 'light',
        machine: true,
      })
      expect((await owned.done).code).toBe(125)
      expect(existsSync(marker)).toBe(false)
      expect(slotsFree(box)).toBe(true)
      expect(
        readdirSync(path.join(box.state, 'jobs')).filter((name) => name.endsWith('.json')),
      ).toEqual([])
    },
    15_000,
  )

  test('a watchdog process that fails before readiness prevents command execution and is collected', async () => {
    const box = deadlineBox(20)
    const marker = path.join(box.root, 'command-ran')
    const failed = path.join(box.root, 'failed-watchdog.sh')
    writeFileSync(failed, '#!/bin/bash\nexit 1\n')
    const env = launcher(
      box,
      `case " $* " in *" --collect "*) args=("$@"); args[\${#args[@]}-4]=${failed}; exec ${systemdRun} "\${args[@]}";; esac`,
    )
    const owned = start(box, 'failed-startup', ['touch', marker], {
      env,
      quiet: true,
      jobClass: 'light',
      machine: true,
    })
    expect((await owned.done).code).not.toBe(0)
    expect(existsSync(marker)).toBe(false)
    expect(slotsFree(box)).toBe(true)
    const services = spawnSync(
      'systemctl',
      [
        '--user',
        'list-units',
        '--all',
        '--plain',
        '--no-legend',
        `${box.sliceRoot}-*_deadline.service`,
      ],
      { encoding: 'utf8' },
    ).stdout.trim()
    expect(services).toBe('')
  }, 15_000)

  test('collects the watchdog after normal completion and orphan reaping', async () => {
    for (const orphan of [false, true]) {
      const box = deadlineBox(60)
      const marker = path.join(box.root, 'command-ran')
      const release = path.join(box.root, 'release')
      const owned = start(
        box,
        'cleanup',
        ['bash', '-c', 'touch "$1"; until [ -e "$2" ]; do sleep 0.02; done', '_', marker, release],
        { quiet: true, jobClass: 'light', machine: true },
      )
      let slice: string | undefined
      try {
        await expect.poll(() => existsSync(marker), { timeout: 10_000 }).toBe(true)
        const [owner] = live(box.state, 'jobs')
        slice = ownSlice(box.sliceRoot, owner!.id)
        expect(unitActive(watchdogOf(slice))).toBe(true)
        if (orphan) {
          const exited = new Promise((resolve) => owned.child.on('exit', resolve))
          owned.child.kill('SIGKILL')
          await exited
          const next = start(box, 'reaper', ['true'], { jobClass: 'light', machine: true })
          expect((await next.done).code).toBe(0)
          expect(next.stderr()).toContain(`stopping ${slice}: its wrapper is gone`)
        } else {
          writeFileSync(release, '')
          expect((await owned.done).code).toBe(0)
        }
        await expect
          .poll(() => serviceState(watchdogOf(slice!)), { timeout: 3_000 })
          .toBe('not-found')
        expect(unitActive(slice)).toBe(false)
        expect(slotsFree(box)).toBe(true)
      } finally {
        writeFileSync(release, '')
        if (slice) killSlice(slice)
        owned.child.kill('SIGTERM')
        await owned.done
      }
    }
  }, 30_000)

  test('a launcher delayed beyond the runtime budget retains fd 6 and arms its deadline only after reaching the slice', async () => {
    const box = deadlineBox()
    const blocked = path.join(box.root, 'blocked')
    const go = path.join(box.root, 'go')
    const marker = path.join(box.root, 'command-ran')
    const env = launcher(
      box,
      `case " $* " in *" --scope "*) touch ${blocked}; until [ -e ${go} ]; do sleep 0.02; done;; esac`,
    )
    const owned = start(
      box,
      'delayed',
      ['bash', '-c', 'trap "" TERM; touch "$1"; exec sleep 60', '_', marker],
      { env, quiet: true, jobClass: 'light', machine: true },
    )
    let slice: string | undefined
    try {
      await expect.poll(() => existsSync(blocked), { timeout: 10_000 }).toBe(true)
      const [owner] = live(box.state, 'jobs')
      slice = ownSlice(box.sliceRoot, owner!.id)
      const exited = new Promise((resolve) => owned.child.on('exit', resolve))
      owned.child.kill('SIGKILL')
      await exited
      // The dead wrapper's launcher holds fd 6 throughout this delay, including a new admission.
      const next = start(box, 'while-delayed', ['true'], { jobClass: 'light', machine: true })
      expect((await next.done).code).toBe(0)
      expect(next.stderr()).not.toContain(`stopping ${slice}`)
      expect(live(box.state, 'jobs').map((entry) => entry.id)).toContain(owner!.id)
      expect(existsSync(marker)).toBe(false)
      expect(serviceState(watchdogOf(slice))).toBe('not-found')
      writeFileSync(go, '')
      await expect.poll(() => existsSync(marker), { timeout: 10_000 }).toBe(true)
      expect(unitActive(watchdogOf(slice))).toBe(true)
      await expect
        .poll(() => sliceState(box.sliceRoot, slice!), { timeout: 6_000 })
        .not.toBe('running')
      const reaper = start(box, 'after-delayed', ['true'], { jobClass: 'light', machine: true })
      expect((await reaper.done).code).toBe(0)
      expect(serviceState(watchdogOf(slice))).toBe('not-found')
    } finally {
      writeFileSync(go, '')
      if (slice) killSlice(slice)
      owned.child.kill('SIGTERM')
      await owned.done
    }
  }, 25_000)

  test.each([
    { name: 'during grace', delay: 2.3, missedTerm: false },
    { name: 'during grace without a delivered TERM', delay: 2.3, missedTerm: true },
    { name: 'past whole-slice KILL', delay: 60, missedTerm: false },
  ])(
    'a readiness return $name cannot start an expired payload',
    async ({ delay, missedTerm }) => {
      const box = deadlineBox()
      const stranger = deadlineBox()
      const canaryPid = path.join(stranger.root, 'canary.pid')
      const canary = start(
        stranger,
        'canary',
        ['bash', '-c', 'echo $$ > "$1"; exec sleep 60', '_', canaryPid],
        { jobClass: 'light', machine: true },
      )
      const armed = path.join(box.root, 'armed')
      const returned = path.join(box.root, 'returned')
      const marker = path.join(box.root, 'command-ran')
      // Suppress both TERM paths to prove the post-readiness clock check independently.
      const pauseWatchdog = missedTerm
        ? 'systemctl --user kill --kill-whom=main --signal=SIGSTOP "${HEAVY_JOB_SLICE%.slice}_deadline.service";'
        : ''
      const scopeFallback = missedTerm
        ? `args=("$@"); for i in "\${!args[@]}"; do if [[ "\${args[i]}" = RuntimeMaxSec=* ]]; then args[i]=RuntimeMaxSec=infinity; fi; done; exec ${systemdRun} "\${args[@]}"`
        : `exec ${systemdRun} "$@"`
      const env = launcher(
        box,
        `case " $* " in *" --collect "*) trap "" TERM; ${systemdRun} "$@" || exit $?; ${pauseWatchdog} touch ${armed}; sleep ${delay}; touch ${returned}; exit 0;; esac\n${scopeFallback}`,
      )
      const owned = start(box, 'late-readiness', ['touch', marker], {
        env,
        quiet: true,
        jobClass: 'light',
        machine: true,
      })
      let slice: string | undefined
      try {
        await expect
          .poll(() => existsSync(armed) && existsSync(canaryPid), { timeout: 10_000 })
          .toBe(true)
        const [owner] = live(box.state, 'jobs')
        slice = ownSlice(box.sliceRoot, owner!.id)
        owned.child.kill('SIGSTOP')
        await expect
          .poll(() => readFileSync(`/proc/${owned.child.pid}/status`, 'utf8'), { timeout: 2_000 })
          .toMatch(/^State:\s+T/m)
        await expect
          .poll(() => sliceState(box.sliceRoot, slice!), { timeout: 5_000 })
          .not.toBe('running')
        expect(existsSync(returned)).toBe(delay < 3)
        expect(existsSync(marker)).toBe(false)
        expect(alive(pidIn(canaryPid))).toBe(true)
        await expect
          .poll(() => serviceState(watchdogOf(slice!)), { timeout: 2_000 })
          .toBe('not-found')
        console.log(
          JSON.stringify({
            event: 'expired-readiness-return',
            delaySeconds: delay,
            missedTerm,
            readinessReturned: existsSync(returned),
            payloadRan: existsSync(marker),
            canaryAlive: alive(pidIn(canaryPid)),
          }),
        )
      } finally {
        if (slice) killSlice(slice)
        owned.child.kill('SIGCONT')
        owned.child.kill('SIGTERM')
        canary.child.kill('SIGTERM')
        await Promise.all([owned.done, canary.done])
      }
      expect((await owned.done).code).toBe(75)
      expect(existsSync(marker)).toBe(false)
      expect(slotsFree(box)).toBe(true)
    },
    15_000,
  )
})
