import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { live } from './queue'
import { bootSeconds, sliceState } from './admission'
import { DEADLINE_START_SECONDS, removeSlice, SCOPE_SHIM } from './job'
import { tryLock, unlock } from './lock'
import { serviceState } from './service-state-query'
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
    await removeSlice(slice, AbortSignal.timeout(5_000))
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
function processObservation(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return {
      pid,
      exists: alive(pid),
      state: fields[0] ?? null,
      parent: fields[1] ?? null,
      start: fields[19] ?? null,
      cgroup: readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim(),
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      (error.code !== 'ENOENT' && error.code !== 'ESRCH')
    )
      throw error
    return { pid, exists: alive(pid), state: null, parent: null, start: null, cgroup: null }
  }
}

function executing(observation: ReturnType<typeof processObservation>, start: string | null) {
  return (
    observation.exists &&
    start !== null &&
    observation.start === start &&
    observation.state !== null &&
    observation.state !== 'Z' &&
    observation.state !== 'X'
  )
}

const processObservationUnavailable =
  process.platform !== 'linux' ||
  !existsSync('/proc/self/stat') ||
  !Bun.which('bash') ||
  !Bun.which('mv')
if (processObservationUnavailable)
  console.info('Process execution calibration requires Linux procfs, Bash, and mv.')

function publishChildPid(gate = '') {
  return `{ ${gate}printf '%s\\n' "$!"; } > "$2.pending" && mv -- "$2.pending" "$2"`
}

test.skipIf(processObservationUnavailable)(
  'process execution observation distinguishes an unreaped child from its live owner',
  async () => {
    const box = sandbox()
    const nestedPid = path.join(box.root, 'child.pid')
    const release = path.join(box.root, 'release')
    const parent = Bun.spawn(
      [
        'bash',
        '-c',
        `bash -c 'until [ -e "$1" ]; do sleep 0.02; done' _ "$1" & ${publishChildPid()}; kill -STOP $$; wait`,
        '_',
        release,
        nestedPid,
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    )
    try {
      await expect.poll(() => existsSync(nestedPid), { timeout: 2_000 }).toBe(true)
      const original = processObservation(pidIn(nestedPid))
      expect(executing(original, original.start)).toBe(true)
      const owner = processObservation(parent.pid)
      expect(executing(owner, owner.start)).toBe(true)
      writeFileSync(release, '')
      await expect
        .poll(() => processObservation(pidIn(nestedPid)).state, { timeout: 2_000 })
        .toBe('Z')
      const zombie = processObservation(pidIn(nestedPid))
      console.log(
        JSON.stringify({ event: 'process-execution-calibration', owner, original, zombie }),
      )
      expect(alive(zombie.pid)).toBe(true)
      expect(zombie.start).toBe(original.start)
      expect(executing(zombie, original.start)).toBe(false)
      expect(executing(processObservation(parent.pid), owner.start)).toBe(true)
    } finally {
      writeFileSync(release, '')
      parent.kill('SIGCONT')
      await parent.exited
    }
  },
)

test.skipIf(processObservationUnavailable)(
  'child PID readiness is published after its complete payload',
  async () => {
    const box = sandbox()
    const nestedPid = path.join(box.root, 'child.pid')
    const release = path.join(box.root, 'release')
    const opened = path.join(box.root, 'opened.pid')
    const gate = 'printf "%s\\n" "$!" > "$3.pending" && mv -- "$3.pending" "$3"; read -r gate; '
    const parent = Bun.spawn(
      [
        'bash',
        '-c',
        `bash -c 'until [ -e "$1" ]; do sleep 0.02; done' _ "$1" & ${publishChildPid(gate)}; wait`,
        '_',
        release,
        nestedPid,
        opened,
      ],
      { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' },
    )
    try {
      await expect.poll(() => existsSync(opened), { timeout: 2_000 }).toBe(true)
      const child = processObservation(pidIn(opened))
      expect(executing(child, child.start)).toBe(true)
      const published = existsSync(nestedPid)
      const observation = {
        event: 'child-pid-publication-boundary',
        published,
        payload: published ? readFileSync(nestedPid, 'utf8') : null,
        observed: published ? processObservation(pidIn(nestedPid)) : null,
        child,
        owner: processObservation(parent.pid),
      }
      expect(published, JSON.stringify(observation)).toBe(false)
      parent.stdin.write('publish\n')
      await parent.stdin.flush()
      await expect.poll(() => existsSync(nestedPid), { timeout: 2_000 }).toBe(true)
      const original = processObservation(pidIn(nestedPid))
      expect(executing(original, original.start)).toBe(true)
      expect(original.pid).toBe(child.pid)
      expect(original.start).toBe(child.start)
      console.log(JSON.stringify({ ...observation, original }))
    } finally {
      parent.stdin.end()
      writeFileSync(release, '')
      await parent.exited
    }
  },
)
const systemdRun = userScopes ? Bun.which('systemd-run') : null
const watchdogOf = (slice: string) => `${slice.slice(0, -'.slice'.length)}_deadline.service`

function launcher(box: ReturnType<typeof sandbox>, body: string) {
  expect(systemdRun).toBeTruthy()
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
  test('a stalled stop-post blocks an ordinary successor with a bounded error', async () => {
    const box = deadlineBox()
    const stranger = deadlineBox()
    const stopPostPid = path.join(box.root, 'stop-post.pid')
    const stopPost = path.join(box.root, 'stop-post.sh')
    writeFileSync(
      stopPost,
      `echo $$ > ${JSON.stringify(stopPostPid)}\nkill -STOP $$\nexec systemctl --user kill --signal=SIGKILL "$1"\n`,
    )
    const env = launcher(
      box,
      `args=("$@"); for i in "\${!args[@]}"; do case "\${args[i]}" in ExecStopPost=*) slice=\${args[i]##* }; args[i]="ExecStopPost=/usr/bin/env bash ${stopPost} $slice";; esac; done; set -- "\${args[@]}"`,
    )
    const mainPid = path.join(box.root, 'main.pid')
    const nestedPid = path.join(box.root, 'nested.pid')
    const canaryPid = path.join(stranger.root, 'canary.pid')
    const marker = path.join(box.root, 'successor')
    const release = path.join(box.root, 'release')
    const canary = start(
      stranger,
      'canary',
      ['bash', '-c', 'echo $$ > "$1"; exec sleep 60', '_', canaryPid],
      { jobClass: 'light', machine: true },
    )
    const owned = start(
      box,
      'stop-post-frozen',
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
      { quiet: true, jobClass: 'light', machine: true, env },
    )
    let next: ReturnType<typeof start> | undefined
    let slice: string | undefined
    try {
      await expect
        .poll(() => existsSync(mainPid) && existsSync(canaryPid), { timeout: 8_000 })
        .toBe(true)
      expect(alive(pidIn(mainPid))).toBe(true)
      expect(alive(pidIn(nestedPid))).toBe(true)
      expect(alive(pidIn(canaryPid))).toBe(true)
      const owner = live(box.state, 'jobs').find((entry) => entry.label === 'stop-post-frozen')!
      slice = ownSlice(box.sliceRoot, owner.id)
      owned.child.kill('SIGSTOP')
      await expect.poll(() => existsSync(stopPostPid), { timeout: 8_000 }).toBe(true)
      await expect.poll(() => bootSeconds(), { timeout: 20_000 }).toBeGreaterThan(owner.quietUntil!)
      expect(alive(pidIn(stopPostPid))).toBe(false)
      expect(serviceState(watchdogOf(slice))).toBe('not-found')
      expect(sliceState(box.sliceRoot, slice)).toBe('running')
      expect(alive(pidIn(nestedPid))).toBe(true)
      const started = performance.now()
      next = start(
        box,
        'ordinary-successor',
        ['bash', '-c', 'touch "$1"; until [ -e "$2" ]; do sleep 0.02; done', '_', marker, release],
        { jobClass: 'light', machine: true },
      )
      await expect
        .poll(() => existsSync(marker) || next!.stderr().includes('Quiet lease'), {
          timeout: 8_000,
        })
        .toBe(true)
      expect(existsSync(marker)).toBe(false)
      const result = await next.done
      expect(result.code).toBe(2)
      expect(result.stderr.match(/warn: quiet lease/g)).toHaveLength(1)
      expect(result.stderr).toContain('Quiet lease')
      expect(result.stderr).toContain('Fix:')
      expect(performance.now() - started).toBeLessThan(8_000)
      expect(alive(pidIn(nestedPid))).toBe(true)
      expect(alive(pidIn(canaryPid))).toBe(true)
    } finally {
      writeFileSync(release, '')
      if (slice) killSlice(slice)
      owned.child.kill('SIGCONT')
      owned.child.kill('SIGTERM')
      canary.child.kill('SIGTERM')
      await Promise.all([owned.done, next?.done, canary.done])
    }
  }, 30_000)

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

  test.each([false, true])(
    'pre-notification delay stays within the lease (frozen watchdog=%s)',
    async (freeze) => {
      const box = deadlineBox(12)
      writeSettings(box, {
        ...JSON.parse(readFileSync(path.join(box.home, 'settings.json'), 'utf8')),
        'developer.heavyJobStopGraceSeconds': 10,
      })
      const stranger = deadlineBox()
      const canaryPid = path.join(stranger.root, 'canary.pid')
      const canary = start(
        stranger,
        'canary',
        ['bash', '-c', 'echo $$ > "$1"; exec sleep 60', '_', canaryPid],
        { jobClass: 'light', machine: true },
      )
      const delayed = path.join(box.root, 'slow-deadline.sh')
      writeFileSync(
        delayed,
        `sleep 7\nexec bash -p ${JSON.stringify(path.join(import.meta.dirname, 'deadline.sh'))} "$@"\n`,
      )
      const env = launcher(
        box,
        `args=("$@"); for i in "\${!args[@]}"; do case "\${args[i]}" in */deadline.sh) args[i]=${JSON.stringify(delayed)};; esac; done; exec ${systemdRun} "\${args[@]}"`,
      )
      const mainPid = path.join(box.root, 'main.pid')
      const nestedPid = path.join(box.root, 'nested.pid')
      const successorMarker = path.join(box.root, 'successor')
      const release = path.join(box.root, 'release')
      const owned = start(
        box,
        'slow-ready',
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
        { quiet: true, jobClass: 'light', machine: true, env },
      )
      let next: ReturnType<typeof start> | undefined
      let slice: string | undefined
      try {
        await expect
          .poll(() => existsSync(mainPid) && existsSync(canaryPid), { timeout: 15_000 })
          .toBe(true)
        const owner = live(box.state, 'jobs').find((entry) => entry.label === 'slow-ready')!
        slice = ownSlice(box.sliceRoot, owner.id)
        expect(bootSeconds()).toBeLessThan(owner.quietUntil! - 10)
        owned.child.kill('SIGSTOP')
        if (freeze)
          expect(
            spawnSync('systemctl', [
              '--user',
              'kill',
              '--kill-whom=main',
              '--signal=SIGSTOP',
              watchdogOf(slice),
            ]).status,
          ).toBe(0)
        next = start(
          box,
          'ordinary-successor',
          [
            'bash',
            '-c',
            'touch "$1"; until [ -e "$2" ]; do sleep 0.02; done',
            '_',
            successorMarker,
            release,
          ],
          { jobClass: 'light', machine: true },
        )
        await expect
          .poll(() => alive(pidIn(mainPid)) || alive(pidIn(nestedPid)), { timeout: 23_000 })
          .toBe(false)
        const drainedAt = bootSeconds()
        expect(drainedAt).toBeLessThan(owner.quietUntil!)
        expect((await next.done).code).toBe(2)
        expect(next.stderr()).toContain('Quiet lease')
        expect(existsSync(successorMarker)).toBe(false)
        expect(live(box.state, 'jobs').some((entry) => entry.id === owner.id)).toBe(true)
        owned.child.kill('SIGCONT')
        await owned.done
        next = start(
          box,
          'released-successor',
          [
            'bash',
            '-c',
            'touch "$1"; until [ -e "$2" ]; do sleep 0.02; done',
            '_',
            successorMarker,
            release,
          ],
          { jobClass: 'light', machine: true },
        )
        await expect.poll(() => existsSync(successorMarker), { timeout: 10_000 }).toBe(true)
        const state = {
          mainAlive: alive(pidIn(mainPid)),
          nestedAlive: alive(pidIn(nestedPid)),
          slice: sliceState(box.sliceRoot, slice),
          canaryAlive: alive(pidIn(canaryPid)),
        }
        console.log(
          JSON.stringify({
            event: 'pre-notification-lease',
            freeze,
            drainedAt,
            watchdog: serviceState(watchdogOf(slice)),
            now: bootSeconds(),
            quietUntil: owner.quietUntil,
            ...state,
          }),
        )
        expect(state.mainAlive).toBe(false)
        expect(state.nestedAlive).toBe(false)
        expect(state.slice).not.toBe('running')
        expect(state.canaryAlive).toBe(true)
        expect(serviceState(watchdogOf(slice))).toBe('not-found')
      } finally {
        writeFileSync(release, '')
        if (slice) killSlice(slice)
        owned.child.kill('SIGCONT')
        owned.child.kill('SIGTERM')
        canary.child.kill('SIGTERM')
        await Promise.all([owned.done, next?.done, canary.done])
      }
    },
    50_000,
  )

  test('a watchdog frozen before READY is bounded by startup and kills only its owned slice', async () => {
    const box = deadlineBox(20)
    const stranger = deadlineBox()
    const canaryPid = path.join(stranger.root, 'canary.pid')
    const canary = start(
      stranger,
      'canary',
      ['bash', '-c', 'echo $$ > "$1"; exec sleep 60', '_', canaryPid],
      { jobClass: 'light', machine: true },
    )
    const frozen = path.join(box.root, 'frozen.pid')
    const nestedPid = path.join(box.root, 'nested.pid')
    const marker = path.join(box.root, 'payload')
    const helper = path.join(box.root, 'frozen-start.sh')
    writeFileSync(
      helper,
      `HEAVY_JOB_SLICE="$1" bash ${JSON.stringify(NESTED)} --unit="\${1%.slice}-nested.scope" bash -c 'trap "" TERM; echo $$ > "$1"; exec sleep 60' _ ${JSON.stringify(nestedPid)} &
until [ -s ${JSON.stringify(nestedPid)} ]; do sleep 0.02; done
sleep 2
echo $$ > ${JSON.stringify(frozen)}
kill -STOP $$
`,
    )
    // Disable runtime fallbacks so startup expiry alone must drain the private sibling.
    const env = launcher(
      box,
      `args=("$@"); for i in "\${!args[@]}"; do case "\${args[i]}" in */deadline.sh) args[i]=${JSON.stringify(helper)};; RuntimeMaxSec=*) args[i]=RuntimeMaxSec=infinity;; esac; done; exec ${systemdRun} "\${args[@]}"`,
    )
    const owned = start(box, 'frozen-startup', ['touch', marker], {
      env,
      quiet: true,
      jobClass: 'light',
      machine: true,
    })
    let slice: string | undefined
    try {
      await expect
        .poll(() => existsSync(frozen) && existsSync(canaryPid), { timeout: 8_000 })
        .toBe(true)
      const owner = live(box.state, 'jobs').find((entry) => entry.label === 'frozen-startup')!
      slice = ownSlice(box.sliceRoot, owner.id)
      const originalNested = processObservation(pidIn(nestedPid))
      expect(originalNested.cgroup).toContain(slice)
      expect(executing(originalNested, originalNested.start)).toBe(true)
      owned.child.kill('SIGSTOP')
      await expect
        .poll(() => sliceState(box.sliceRoot, slice!), {
          timeout: (DEADLINE_START_SECONDS + 3) * 1000,
        })
        .not.toBe('running')
      console.log(
        JSON.stringify({
          event: 'frozen-before-ready-observation',
          frozen: processObservation(pidIn(frozen)),
          nested: processObservation(pidIn(nestedPid)),
          originalNested,
          canary: processObservation(pidIn(canaryPid)),
          slice: sliceState(box.sliceRoot, slice),
          payloadRan: existsSync(marker),
        }),
      )
      expect(alive(pidIn(frozen))).toBe(false)
      expect(executing(processObservation(pidIn(nestedPid)), originalNested.start)).toBe(false)
      expect(existsSync(marker)).toBe(false)
      expect(alive(pidIn(canaryPid))).toBe(true)
      await expect
        .poll(() => serviceState(watchdogOf(slice!)), { timeout: 2_000 })
        .toBe('not-found')
      console.log(
        JSON.stringify({
          event: 'frozen-before-ready',
          now: bootSeconds(),
          quietUntil: owner.quietUntil,
          nestedAlive: alive(pidIn(nestedPid)),
          watchdogAlive: alive(pidIn(frozen)),
          slice: sliceState(box.sliceRoot, slice),
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
  }, 25_000)

  test('healthy heartbeats preserve a running job beyond the native watchdog interval', async () => {
    const box = deadlineBox(20)
    const marker = path.join(box.root, 'payload.pid')
    const owned = start(
      box,
      'healthy-watchdog',
      ['bash', '-c', 'echo $$ > "$1"; sleep 6', '_', marker],
      { quiet: true, jobClass: 'light', machine: true },
    )
    let slice: string | undefined
    try {
      await expect.poll(() => existsSync(marker), { timeout: 8_000 }).toBe(true)
      const owner = live(box.state, 'jobs').find((entry) => entry.label === 'healthy-watchdog')!
      slice = ownSlice(box.sliceRoot, owner.id)
      expect((await owned.done).code).toBe(0)
      expect(serviceState(watchdogOf(slice))).toBe('not-found')
      expect(slotsFree(box)).toBe(true)
    } finally {
      if (slice) killSlice(slice)
      owned.child.kill('SIGTERM')
      await owned.done
    }
  }, 15_000)

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
      const result = await owned.done
      expect(result.code, result.stderr).toBe(125)
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

  test('a launcher delayed beyond the quiet deadline retains fd 6 until scope entry rejects its expired payload', async () => {
    const box = deadlineBox()
    const blocked = path.join(box.root, 'blocked')
    const go = path.join(box.root, 'go')
    const marker = path.join(box.root, 'command-ran')
    const entered = path.join(box.root, 'scope-entry.pid')
    const pausedShim = path.join(box.root, 'paused-scope.sh')
    writeFileSync(
      pausedShim,
      readFileSync(SCOPE_SHIM, 'utf8').replace(
        'exec 6<&-',
        () => `exec 6<&-\nprintf '%s\\n' "$$" > ${JSON.stringify(entered)}\nkill -STOP $$`,
      ),
    )
    const env = launcher(
      box,
      `case " $* " in *" --scope "*) touch ${blocked}; until [ -e ${go} ]; do sleep 0.02; done; args=("$@"); for i in "\${!args[@]}"; do if [ "\${args[i]}" = "${SCOPE_SHIM}" ]; then args[i]="${pausedShim}"; fi; done; set -- "\${args[@]}";; esac`,
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
      // The dead wrapper's launcher holds fd 6, so even an empty cgroup blocks admission.
      const successorMarker = path.join(box.root, 'successor-ran')
      const next = start(box, 'while-delayed', ['touch', successorMarker], {
        jobClass: 'light',
        machine: true,
      })
      expect(
        (await next.done).code,
        JSON.stringify({
          stderr: next.stderr(),
          now: bootSeconds(),
          quietUntil: owner!.quietUntil,
          owners: live(box.state, 'jobs'),
          cgroup: sliceState(box.sliceRoot, slice),
        }),
      ).toBe(2)
      expect(bootSeconds()).toBeGreaterThanOrEqual(owner!.quietUntil!)
      expect(next.stderr()).toContain(`Quiet lease 'delayed' remains held by ${slice} (empty)`)
      expect(next.stderr().match(/warn: quiet lease/g)).toHaveLength(1)
      expect(next.stderr()).not.toContain(`stopping ${slice}`)
      expect(live(box.state, 'jobs').map((entry) => entry.id)).toContain(owner!.id)
      expect(
        readdirSync(path.join(box.state, 'queue')).filter((file) => file.endsWith('.json')),
      ).toEqual([])
      expect(existsSync(successorMarker)).toBe(false)
      expect(existsSync(marker)).toBe(false)
      expect(serviceState(watchdogOf(slice))).toBe('not-found')
      writeFileSync(go, '')
      await expect.poll(() => existsSync(entered), { timeout: 6_000 }).toBe(true)
      await expect
        .poll(() => processObservation(pidIn(entered)).state, { timeout: 6_000 })
        .toBe('T')
      await expect
        .poll(() => live(box.state, 'jobs').map((entry) => entry.id), { timeout: 6_000 })
        .not.toContain(owner!.id)
      // Entry ownership ends before the scope checks its expired deadline.
      expect(sliceState(box.sliceRoot, slice)).toBe('running')
      process.kill(pidIn(entered), 'SIGCONT')
      await expect
        .poll(() => sliceState(box.sliceRoot, slice!), { timeout: 6_000 })
        .not.toBe('running')
      expect(existsSync(marker)).toBe(false)
      expect(serviceState(watchdogOf(slice))).toBe('not-found')
      expect(slotsFree(box)).toBe(true)
      const reaper = start(box, 'after-delayed', ['touch', successorMarker], {
        jobClass: 'light',
        machine: true,
      })
      expect((await reaper.done).code).toBe(0)
      expect(existsSync(successorMarker)).toBe(true)
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
