import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import {
  installedPromote,
  meshOrigin,
  productionRoot,
  promoteSource,
  serverPort,
  serverUnit,
  tuiOrigin,
  unitTemplate,
} from './config'
import { log, output, run } from './run'
import {
  launchLiveCheck,
  releaseBody as probeRelease,
  signalServer,
  spawnLauncher,
  type Launch,
  type LiveCheckTarget,
  type SignalOutcome,
} from './systemd/promote'
import { createScriptError } from '../structured-errors'
import { approveRestart, readStagedRelease } from '../../apps/server/src/update/staged-release'

const unitDirectory = path.join(homedir(), '.config/systemd/user')
const installedUnit = path.join(unitDirectory, serverUnit)
const dropInDirectory = `${installedUnit}.d`

/** How the running server took a staged release. */
type NotifyOutcome = 'staged' | 'promoted' | 'started' | 'restarted'

export type ReleaseBody = {
  server?: { release?: string | null }
  pending?: { release?: string } | null
}

/** Installs the promotion step and the rendered unit; a changed unit applies at the next restart. */
export async function installUnit() {
  installPromote()
  const rendered = renderUnit()
  const installed = existsSync(installedUnit) ? readFileSync(installedUnit, 'utf8') : null
  const dropIns = existsSync(dropInDirectory)
  if (installed === rendered && !dropIns) return

  mkdirSync(unitDirectory, { recursive: true })
  writeFileSync(installedUnit, rendered)
  // Drop-ins predate the template; everything they set is rendered above.
  rmSync(dropInDirectory, { force: true, recursive: true })
  await systemctl('daemon-reload')
  await systemctl('enable', serverUnit)
  log('systemd', `installed ${installedUnit}; it applies at the next restart`)
}

function installPromote() {
  const source = readFileSync(promoteSource, 'utf8')
  const installed = existsSync(installedPromote) ? readFileSync(installedPromote, 'utf8') : null
  if (installed === source) return

  mkdirSync(path.dirname(installedPromote), { recursive: true })
  const staging = `${installedPromote}.next-${process.pid}`
  writeFileSync(staging, source)
  renameSync(staging, installedPromote)
  log('systemd', `installed ${installedPromote}`)
}

/** How the deploy reaches the running server; tests pass a scripted one. */
export type ServerControl = {
  activeState: () => Promise<string>
  systemctl: (...args: string[]) => Promise<void>
  releaseBody: () => Promise<ReleaseBody | null>
  signal: () => Promise<SignalOutcome>
  approve: (name: string) => void
  launch: Launch
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const liveControl: ServerControl = {
  activeState: () =>
    output(['systemctl', '--user', 'show', '-p', 'ActiveState', '--value', serverUnit]),
  systemctl,
  releaseBody: async () => (await probeRelease(serverPort)) as ReleaseBody | null,
  signal: () => signalServer(serverPort),
  approve: (name) => {
    const { staged } = readStagedRelease(productionRoot, null)
    if (staged?.release !== name)
      throw notAcknowledged(name, 'The staged release changed before startup')
    approveRestart(productionRoot, staged)
  },
  launch: spawnLauncher,
  now: Date.now,
  sleep: (ms) => Bun.sleep(ms),
}

/** Tells the server a release is staged; starts or restarts it only when it cannot be told. */
export async function notifyServer(name: string, control = liveControl): Promise<NotifyOutcome> {
  const state = await control.activeState()
  if (state === 'inactive' || state === 'failed') return startServer(name, state, control)

  const body = await waitForBody(30_000, control)
  if (!body)
    throw notAcknowledged(name, `${serverUnit} is ${state} but did not answer GET /release`)
  if (body.server?.release === name) return 'promoted'
  if (!('pending' in body)) return transitionRestart(name, control)

  return signalStaged(name, control)
}

async function startServer(name: string, state: string, control: ServerControl) {
  control.approve(name)
  if (state === 'failed') await control.systemctl('reset-failed', serverUnit)
  log('systemd', `starting ${serverUnit}; its promotion step takes ${name}`)
  await control.systemctl('start', serverUnit)
  await waitForServerRelease(name, control)
  return 'started' as const
}

// The first deploy onto a server without the SIGUSR2 handler; after it, nothing restarts unasked.
async function transitionRestart(name: string, control: ServerControl) {
  control.approve(name)
  log('systemd', 'the running server predates staged releases; restarting it once')
  await restartServer(control)
  await waitForServerRelease(name, control)
  return 'restarted' as const
}

async function signalStaged(name: string, control: ServerControl): Promise<NotifyOutcome> {
  const signal = await control.signal()
  if (signal !== 'signalled') throw notAcknowledged(name, `signalling ${serverUnit} gave ${signal}`)

  const deadline = control.now() + 15_000
  while (control.now() < deadline) {
    const body = await control.releaseBody()
    if (body?.server?.release === name) return 'promoted'
    if (body?.pending?.release === name) return 'staged'
    await control.sleep(500)
  }
  throw notAcknowledged(name, `${serverUnit} did not report ${name} as pending within 15000ms`)
}

function notAcknowledged(name: string, reason: string) {
  return createScriptError(
    `${reason}. ${name} is staged; confirm Restart in the app to apply it. ` +
      `Check: journalctl --user -u ${serverUnit} -n 50`,
  )
}

// The check starts first and outside the service, so a rollback typed in a Platform
// terminal, which the restart ends, is still checked. Returns the check unit, or null.
export async function restartInto(
  target: LiveCheckTarget,
  liveCheck: boolean,
  control = liveControl,
) {
  const unit = liveCheck ? launchLiveCheck(target, productionRoot, control.launch) : null
  if (liveCheck && !unit) log('live', 'the live check unit did not start')
  await restartServer(control)
  await waitForServerRelease(target.name, control)
  return unit
}

async function restartServer(control: ServerControl) {
  log('systemd', `restarting ${serverUnit}`)
  await control.systemctl('restart', serverUnit)
}

/** Waits for the server to report the target release's own name. */
export async function waitForServerRelease(expected: string, control = liveControl) {
  const timeoutMs = 60_000
  const deadline = control.now() + timeoutMs
  while (control.now() < deadline) {
    const body = await control.releaseBody()
    if (body?.server?.release === expected) return
    await control.sleep(500)
  }

  throw createScriptError(
    `${serverUnit} did not report release ${expected} within ${timeoutMs}ms. ` +
      `Check: journalctl --user -u ${serverUnit} -n 50`,
  )
}

async function waitForBody(timeoutMs: number, control: ServerControl) {
  const deadline = control.now() + timeoutMs
  while (control.now() < deadline) {
    const body = await control.releaseBody()
    if (body) return body
    await control.sleep(500)
  }
  return null
}

export function renderUnit(values: Record<string, string> = unitValues()) {
  return readFileSync(unitTemplate, 'utf8').replaceAll(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw createScriptError(`Unit template names unknown value ${key}.`)
    return value
  })
}

function unitValues(): Record<string, string> {
  return {
    BUN: process.execPath,
    HOME: homedir(),
    MESH_ORIGIN: meshOrigin,
    PORT: String(serverPort),
    PRODUCTION_ROOT: productionRoot,
    TUI_ORIGIN: tuiOrigin,
  }
}

async function systemctl(...args: string[]) {
  const result = await run(['systemctl', '--user', ...args])
  if (result.code === 0) return

  throw createScriptError(`systemctl --user ${args.join(' ')} failed with exit ${result.code}.`)
}
