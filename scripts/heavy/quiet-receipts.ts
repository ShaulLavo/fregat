import { spawnSync } from 'node:child_process'
import { closeSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'

import { bootSeconds } from './admission'
import { lockDescriptor, openExisting } from './lock'
import type { Box, start } from './sandbox'

type Failure = {
  readonly box: Box
  readonly jobs: Readonly<Record<string, ReturnType<typeof start> | undefined>>
  readonly units?: readonly string[]
  readonly manager?: ReturnType<typeof spawnSync>
  readonly launcher?: {
    readonly pid: number | undefined
    readonly resultFile: string
    readonly checkpoints: readonly ReturnType<typeof quietLauncherReceipt>[]
  }
}

export function quietLauncherReceipt(pid: number | undefined, phase: string) {
  const boot = bootSeconds()
  if (pid === undefined) return { phase, bootSeconds: boot, created: false }
  return {
    phase,
    bootSeconds: boot,
    pid,
    status: capture(() => readFileSync(`/proc/${pid}/status`, 'utf8')),
    cgroup: capture(() => readFileSync(`/proc/${pid}/cgroup`, 'utf8')),
    fd6: capture(() => readlinkSync(`/proc/${pid}/fd/6`)),
    fd6Info: capture(() => readFileSync(`/proc/${pid}/fdinfo/6`, 'utf8')),
  }
}

export function quietFailureReceipt({ box, jobs, units = [], manager, launcher }: Failure) {
  return capture(() => ({
    bootSeconds: bootSeconds(),
    fixtureRoot: box.root,
    sliceRoot: box.sliceRoot,
    jobs: Object.entries(jobs).map(([name, job]) => {
      if (!job) return { name, created: false }
      const { pid, exitCode, signalCode } = job.child
      return {
        name,
        pid,
        exitCode,
        signalCode,
        stdout: job.stdout(),
        stderr: job.stderr(),
        status: capture(() => readFileSync(`/proc/${pid}/status`, 'utf8')),
        wchan: capture(() => readFileSync(`/proc/${pid}/wchan`, 'utf8')),
      }
    }),
    state: Object.fromEntries(
      ['queue', 'jobs', 'runs', 'measurements', 'reaping'].map((place) => [
        place,
        files(path.join(box.state, place), place === 'queue' || place === 'jobs'),
      ]),
    ),
    holder: capture(() => readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')),
    records: files(box.logs),
    launcher: launcher
      ? {
          current: quietLauncherReceipt(launcher.pid, 'failure'),
          result: capture(() => readFileSync(launcher.resultFile, 'utf8')),
          checkpoints: launcher.checkpoints,
        }
      : null,
    clientVersion: query(['systemd-run', '--version']),
    managerVersion: query(['systemctl', '--user', 'show', '--property=Version,SystemState']),
    managerCommand: manager ? resultReceipt(manager) : null,
    managerUnits: query([
      'systemctl',
      '--user',
      'show',
      '--all',
      '--property=Id,LoadState,ActiveState,SubState,Result,RuntimeMaxUSec,TimeoutStopUSec,ControlGroup,InvocationID',
      `${box.sliceRoot}*`,
      ...units.filter(
        (unit) => unit.startsWith(`${box.sliceRoot}-`) || unit === `${box.sliceRoot}.slice`,
      ),
    ]),
    managerJournal: query([
      'journalctl',
      '--user',
      '--no-pager',
      '--output=short-monotonic',
      '--lines=40',
      `--unit=${box.sliceRoot}*`,
    ]),
  }))
}

function files(directory: string, ownership = false) {
  return capture(() =>
    readdirSync(directory)
      .toSorted()
      .map((name) => {
        const file = path.join(directory, name)
        return {
          name,
          receipt: ownership ? entry(file) : capture(() => readFileSync(file, 'utf8')),
        }
      }),
  )
}

function entry(file: string) {
  return capture(() => {
    const fd = openExisting(file)
    if (fd === null) return null
    try {
      return { text: readFileSync(fd, 'utf8'), owned: !lockDescriptor(fd) }
    } finally {
      closeSync(fd)
    }
  })
}

function query(command: readonly string[]) {
  return { command, ...resultReceipt(spawnSync(command[0]!, command.slice(1), { timeout: 1_000 })) }
}

function resultReceipt(result: ReturnType<typeof spawnSync>) {
  return {
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout?.toString(),
    stderr: result.stderr?.toString(),
  }
}

function capture<T>(read: () => T): T | { receiptError: string } {
  try {
    return read()
  } catch (error) {
    return { receiptError: String(error) }
  }
}
