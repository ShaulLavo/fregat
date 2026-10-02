import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import {
  machineServiceIntentSchema,
  type MachineServiceIntent,
  type MachineServiceResult,
  type ServerIdentity,
} from '../../packages/contracts/src/server-identity'
import { descriptorFor } from '../../packages/contracts/src/settings/keys'
import * as v from 'valibot'
import { acquireSetupLock } from './setup-lock'
import { buildPromoterSource } from '../deploy/promoter-source'
import { realServiceHost, type ServiceHost } from './host'
import { portHolder } from './holder'
import { probeAddress, type ProbeOutcome } from './probe'
import { serviceErrors } from './structured-errors'
import {
  LAUNCHD_LABEL,
  registrationFiles,
  registrationValues,
  renderLaunchAgent,
  renderSystemdService,
  renderSystemdSocket,
  SERVICE_UNIT,
  SOCKET_UNIT,
  type UnitValues,
} from './units'

export type EnsureMachineServiceOptions = {
  /** The resolved `server.releaseRoot` (see `machineReleaseRoot`); it must hold `current/`. */
  productionRoot: string
  /** Defaults to the `server.activationTimeoutSeconds` registry default. */
  readinessMs?: number
  signal?: AbortSignal
  host?: ServiceHost
  fetch?: typeof fetch
}

const RETRY_MS = 100

/**
 * One-time setup: reuse the server already serving this state home at the fixed address, or
 * register the OS socket and service and wait until the activated server proves its identity.
 * Anything else at the address is a structured conflict, and the listener is left untouched.
 */
export async function ensureMachineService(
  intent: MachineServiceIntent,
  options: EnsureMachineServiceOptions,
): Promise<MachineServiceResult> {
  const host = options.host ?? realServiceHost()
  if (host.platform !== 'linux' && host.platform !== 'darwin')
    throw serviceErrors.UNSUPPORTED_PLATFORM({ internal: { platform: host.platform } })
  const parsed = v.parse(machineServiceIntentSchema, intent)
  mkdirSync(parsed.stateHome, { recursive: true, mode: 0o700 })
  const stateHome = realpathSync(parsed.stateHome)
  const readinessMs =
    options.readinessMs ?? descriptorFor('server.activationTimeoutSeconds').default * 1000
  const deadline = Date.now() + readinessMs
  const lock = await acquireSetupLock(registrationFiles(host).lock, deadline, options.signal)
  try {
    const context = { ...parsed, stateHome, host, deadline, options }
    const first = await probe(context)
    // A listener that cannot answer yet (starting, a reset connection) gets the same bounded wait.
    if (first.kind === 'unverified')
      return { identity: await awaitReady(context, first), disposition: 'reused' }
    if (first.kind !== 'free')
      return { identity: await verified(context, first), disposition: 'reused' }
    await register(context)
    return { identity: await awaitReady(context), disposition: 'registered' }
  } finally {
    lock.release()
  }
}

type Context = MachineServiceIntent & {
  host: ServiceHost
  deadline: number
  options: EnsureMachineServiceOptions
}

function probe(context: Context) {
  return probeAddress(
    {
      address: context.address,
      stateHome: context.stateHome,
      timeoutMs: Math.max(1, context.deadline - Date.now()),
      signal: context.options.signal,
    },
    context.options.fetch,
  )
}

async function verified(context: Context, outcome: ProbeOutcome): Promise<ServerIdentity> {
  if (outcome.kind === 'free' || outcome.kind === 'unverified')
    throw serviceErrors.IDENTITY_UNVERIFIED({
      internal: { reason: outcome.kind === 'free' ? 'not-listening' : outcome.reason },
    })
  if (outcome.kind === 'other') {
    const port = Number(new URL(context.address).port)
    throw serviceErrors.ADDRESS_HELD_BY_OTHER_PROGRAM({
      internal: { status: outcome.status, holder: await portHolder(context.host, port) },
    })
  }
  const mismatch = identityMismatch(context, outcome.identity)
  if (mismatch) throw serviceErrors.ADDRESS_HELD_BY_OTHER_FREGAT({ internal: { mismatch } })
  if (!outcome.proven) throw serviceErrors.IDENTITY_UNVERIFIED({ internal: { reason: 'proof' } })
  return outcome.identity
}

function identityMismatch(context: Context, identity: ServerIdentity) {
  if (identity.stateHome !== context.stateHome) return 'state-home'
  if (identity.address !== context.address) return 'address'
  if (!context.expected) return null
  if (identity.machineId !== context.expected.machineId) return 'machine'
  if (context.expected.environmentId && identity.environmentId !== context.expected.environmentId)
    return 'environment'
  return null
}

/** The first request activates the service; a slow start is waited out, never retried blind. */
async function awaitReady(
  context: Context,
  last: ProbeOutcome = { kind: 'free' },
): Promise<ServerIdentity> {
  let outcome = last
  while (Date.now() < context.deadline) {
    context.options.signal?.throwIfAborted()
    outcome = await probe(context)
    if (outcome.kind !== 'free' && outcome.kind !== 'unverified') break
    await Bun.sleep(RETRY_MS)
  }
  return verified(context, outcome)
}

async function register(context: Context) {
  const { host } = context
  const root = context.options.productionRoot
  if (!existsSync(path.join(root, 'current', 'server', 'index.js')))
    throw serviceErrors.REGISTRATION_FAILED({
      internal: { stage: 'release', hasRoot: existsSync(root) },
    })
  await installPromote(host, root)
  const values: UnitValues = {
    bun: host.bun,
    releaseRoot: root,
    stateHome: context.stateHome,
    port: Number(new URL(context.address).port),
  }
  const files = registrationFiles(host)
  if (files.kind === 'launchd') {
    writeOwned(host, files.plist, renderLaunchAgent(values))
    await bootstrapLaunchAgent(host, files.plist)
    return
  }
  writeOwned(host, files.socket, renderSystemdSocket(values))
  writeOwned(host, files.service, renderSystemdService(values))
  await required(host, ['systemctl', '--user', 'daemon-reload'], 'daemon-reload')
  await required(host, ['systemctl', '--user', 'enable', '--now', SOCKET_UNIT], 'enable')
}

/** Writes a registration file this setup renders; another installation's file is not replaced. */
function writeOwned(host: ServiceHost, file: string, content: string) {
  const existing = host.readFile(file)
  if (existing === content) return
  if (existing !== null)
    throw serviceErrors.REGISTRATION_FAILED({
      internal: { stage: 'existing-registration', file: path.basename(file) },
    })
  host.writeFile(file, content)
}

async function installPromote(host: ServiceHost, root: string) {
  const target = path.join(root, 'bin', 'promote.js')
  const source =
    host.readFile(path.join(root, 'current', 'bin', 'promote.js')) ?? (await buildPromoterSource())
  if (host.readFile(target) !== source) host.writeFile(target, source)
}

async function bootstrapLaunchAgent(host: ServiceHost, plist: string) {
  const domain = `gui/${host.uid}`
  const loaded = await host.run(['launchctl', 'print', `${domain}/${LAUNCHD_LABEL}`])
  if (loaded.code === 0) return
  await required(host, ['launchctl', 'bootstrap', domain, plist], 'bootstrap')
}

async function required(host: ServiceHost, argv: readonly string[], stage: string) {
  const result = await host.run(argv)
  if (result.code !== 0)
    throw serviceErrors.REGISTRATION_FAILED({ internal: { stage, exitCode: result.code } })
}

/**
 * The explicit machine-server uninstall. Under the registration lock setup also takes, every
 * present file must be an exact re-render of one shared set of recorded values, and the address
 * must be free or answer with that state home's proof. State, logs and releases stay.
 */
export async function removeMachineService(
  options: { host?: ServiceHost; signal?: AbortSignal; readinessMs?: number } = {},
) {
  const host = options.host ?? realServiceHost()
  options.signal?.throwIfAborted()
  const files = registrationFiles(host)
  const readinessMs =
    options.readinessMs ?? descriptorFor('server.activationTimeoutSeconds').default * 1000
  const lock = await acquireSetupLock(files.lock, Date.now() + readinessMs, options.signal)
  try {
    const owned = ownedRegistration(host, files)
    if (!owned) return { removed: false }
    await requireOwnListener(owned.values, readinessMs, options.signal)
    // The lock keeps setup out; any file appearing, vanishing or changing since the check stops it.
    if (owned.snapshot.some(({ file, content }) => host.readFile(file) !== content))
      throw serviceErrors.REGISTRATION_NOT_OURS({ internal: { reason: 'changed' } })
    if (files.kind === 'launchd')
      await required(host, ['launchctl', 'bootout', `gui/${host.uid}/${LAUNCHD_LABEL}`], 'bootout')
    else
      await required(
        host,
        ['systemctl', '--user', 'disable', '--now', ...owned.present.map(({ unit }) => unit)],
        'disable',
      )
    for (const { file } of owned.present) host.removeFile(file)
    if (files.kind === 'systemd')
      await required(host, ['systemctl', '--user', 'daemon-reload'], 'daemon-reload')
    return { removed: true }
  } finally {
    lock.release()
  }
}

/** The registration files present now, all rendered from the same recorded values, or null. */
function ownedRegistration(host: ServiceHost, files: ReturnType<typeof registrationFiles>) {
  const candidates =
    files.kind === 'launchd'
      ? [{ file: files.plist, render: renderLaunchAgent, unit: LAUNCHD_LABEL }]
      : [
          { file: files.socket, render: renderSystemdSocket, unit: SOCKET_UNIT },
          { file: files.service, render: renderSystemdService, unit: SERVICE_UNIT },
        ]
  // Every fixed path, absent ones included, so a file appearing later is a change too.
  const snapshot = candidates.map((candidate) => ({
    ...candidate,
    content: host.readFile(candidate.file),
  }))
  const present = snapshot.flatMap(({ content, ...candidate }) =>
    content === null ? [] : [{ ...candidate, content }],
  )
  if (present.length === 0) return null
  const recorded = present.map(({ file, render, content }) => {
    const values = registrationValues(content, render)
    if (!values)
      throw serviceErrors.REGISTRATION_NOT_OURS({
        internal: { file: path.basename(file), reason: 'contents' },
      })
    return values
  })
  const [values] = recorded
  if (!values || recorded.some((other) => JSON.stringify(other) !== JSON.stringify(values)))
    throw serviceErrors.REGISTRATION_NOT_OURS({ internal: { reason: 'mismatch' } })
  return { values, present, snapshot }
}

/** A free address, or a server proving the recorded state home; anything else is not ours to stop. */
async function requireOwnListener(values: UnitValues, timeoutMs: number, signal?: AbortSignal) {
  const outcome = await probeAddress({
    address: `http://127.0.0.1:${values.port}`,
    stateHome: values.stateHome,
    timeoutMs,
    signal,
  })
  if (outcome.kind === 'free') return
  if (
    outcome.kind === 'fregat' &&
    outcome.proven &&
    outcome.identity.stateHome === values.stateHome
  )
    return
  throw serviceErrors.REGISTRATION_NOT_OURS({
    internal: { reason: 'listener', outcome: outcome.kind, port: values.port },
  })
}
