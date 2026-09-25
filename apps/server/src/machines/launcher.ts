import { errorMessage, ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
import type {
  EnvironmentId,
  HealthDescriptor,
  Machines,
  MachineConnectionState,
  SshMachineDefinition,
} from '@workspace/contracts'
import { recordProcessError, recordProcessInfo } from '../observability/runtime'
import { isEvlogError } from '../observability/structured-errors'
import {
  createSshError,
  createSshProtocolError,
  machineConnectionError,
  sshProtocolCode,
  type SshCatalogStep,
  type SshErrorStep,
} from './structured-errors'
import {
  openForward,
  probeDescriptor,
  reserveForwardPort,
  runSshCommand,
  spawnSsh,
  waitForDescriptor,
  type SshForward,
  type SshSpawner,
} from './forward'
import {
  parseMachineName,
  parseMachineSettings,
  parseRemoteRecord,
  parseInstallation,
  type RemoteRecord,
} from './records'
import { launchCommand, launchFailureFix, probeCommand, stopCommand } from './remote-scripts'
import type { ServerInstallation } from '../installation/descriptor'

type Connection = {
  name: string
  machine: SshMachineDefinition | null
  installation: ServerInstallation | null
  controller: AbortController
  forward: SshForward | null
  record: RemoteRecord | null
  remoteAttempted: boolean
  preserveRemoteOnFailure: boolean
  state: MachineConnectionState
}

type ConnectEvent = {
  machine: string
  target?: string
  installationDirectory?: string
  installationKind?: ServerInstallation['kind']
  serverVersion?: string
  step: SshErrorStep
  steps: Partial<Record<SshErrorStep, number>>
  outcome: 'pending' | 'success' | 'failed' | 'cancelled'
  durationMs?: number
  environmentId?: EnvironmentId
  localPort?: number
  remotePort?: number
  managed?: boolean
  error?: string
  errorCode?: string
  errorInternal?: Record<string, unknown>
  cleanupError?: string
}

type LauncherOptions = {
  clientId: string
  webOrigin: string
  readMachines: () => Promise<Machines>
  publish: (state: MachineConnectionState) => void
  spawn?: SshSpawner
  forward?: typeof openForward
  fetcher?: typeof fetch
  localPort?: (retainedPort?: number) => Promise<number>
  record?: (action: string, fields: Record<string, unknown>, failed: boolean) => void
}

export function createSshLauncher(options: LauncherOptions) {
  const connections = new Map<string, Connection>()
  const pending = new Map<string, Promise<MachineConnectionState>>()
  const disconnecting = new Map<string, Promise<void>>()
  const ports = new Map<string, number>()
  const identities = new Map<string, EnvironmentId>()
  const spawn = options.spawn ?? spawnSsh
  const writeLog = options.record ?? recordEvent
  let closing = false

  function publish(connection: Connection, state: MachineConnectionState) {
    connection.state = state
    options.publish(state)
  }

  async function connectMachine(input: string): Promise<MachineConnectionState> {
    const name = await parseMachineName(input)
    if (closing) throw createSshError('settings', 'The backend is closing.')
    await disconnecting.get(name)
    const running = pending.get(name)
    if (running) return running
    const operation = connect(name).finally(() => pending.delete(name))
    pending.set(name, operation)
    return operation
  }

  async function step<T>(event: ConnectEvent, name: SshErrorStep, action: () => Promise<T>) {
    event.step = name
    const startedAt = Date.now()
    try {
      return await action()
    } finally {
      event.steps[name] = Date.now() - startedAt
    }
  }

  async function connect(name: string): Promise<MachineConnectionState> {
    const previous = connections.get(name)
    if (closing) throw createSshError('settings', 'The backend is closing.')
    const event: ConnectEvent = { machine: name, step: 'settings', steps: {}, outcome: 'pending' }
    const startedAt = Date.now()
    let connection = previous ?? newConnection(name)
    try {
      if (previous && (await refreshLiveConnection(previous, event))) {
        event.outcome = 'success'
        return previous.state
      }
      if (closing) throw createSshError('settings', 'The backend is closing.')
      connection = newConnection(name, previous)
      connections.set(name, connection)
      publish(connection, connection.state)
      if (previous) await closeConnectionForward(previous)
      connection.controller.signal.throwIfAborted()
      const descriptor = await establish(connection, event)
      event.environmentId = descriptor.environmentId
      event.outcome = 'success'
      return connection.state
    } catch (error) {
      return await failed(connection, event, error)
    } finally {
      event.durationMs = Date.now() - startedAt
      writeLog('machines.ssh.connect', event, event.outcome === 'failed')
    }
  }

  function newConnection(name: string, previous?: Connection): Connection {
    return {
      name,
      machine: previous?.machine ?? null,
      installation: previous?.installation ?? null,
      controller: new AbortController(),
      forward: null,
      record: previous?.record ?? null,
      remoteAttempted: previous?.remoteAttempted ?? false,
      preserveRemoteOnFailure: previous?.preserveRemoteOnFailure ?? false,
      state: { name, phase: 'launching' },
    }
  }

  async function refreshLiveConnection(connection: Connection, event: ConnectEvent) {
    const state = connection.state
    if (state.phase !== 'live' || !connection.forward) return false
    const descriptor = await step(event, 'readiness', () =>
      probeDescriptor({
        origin: state.origin,
        webOrigin: options.webOrigin,
        signal: connection.controller.signal,
        fetcher: options.fetcher ?? fetch,
      }),
    )
    connection.controller.signal.throwIfAborted()
    if (!descriptor || connection.state.phase !== 'live' || !connection.forward) return false
    const child = connection.forward.child
    if (child.exitCode !== null || child.signalCode !== null) return false
    event.serverVersion = descriptor.serverVersion
    await step(event, 'protocol', async () => confirmProtocol(connection, descriptor))
    await step(event, 'identity', async () => confirmIdentity(connection, descriptor))
    event.target = connection.machine?.target
    event.installationKind = connection.installation?.kind
    event.environmentId = descriptor.environmentId
    event.localPort = connection.state.localPort
    event.remotePort = connection.record?.port
    event.managed = connection.record?.kind === 'managed'
    publish(connection, { ...connection.state, descriptor })
    return true
  }

  async function establish(connection: Connection, event: ConnectEvent) {
    const machines = await step(event, 'settings', async () =>
      parseMachineSettings(await options.readMachines()),
    )
    const machine = machines[connection.name]
    if (!machine || machine.kind !== 'ssh')
      throw createSshError('settings', `No SSH machine named ${connection.name} exists.`)
    if (connection.machine && changedRemote(connection.machine, machine)) {
      await cleanup(connection)
      connection.preserveRemoteOnFailure = false
    }
    connection.machine = machine
    event.target = machine.target
    const installation = parseInstallation(
      await step(event, 'probe', () => command(connection, machine, probeCommand(), 'probe')),
    )
    if (connection.installation && connection.installation.directory !== installation.directory) {
      await cleanup(connection)
      connection.preserveRemoteOnFailure = false
    }
    connection.installation = installation
    event.installationDirectory = installation.directory
    event.installationKind = installation.kind
    connection.remoteAttempted = true
    connection.record = null
    const output = await step(event, 'launch', () =>
      command(
        connection,
        machine,
        launchCommand({
          machine,
          installation,
          clientId: connectionClientId(connection),
          webOrigin: options.webOrigin,
        }),
        'launch',
        launchFailureFix(installation),
      ),
    )
    connection.record = await parseRemoteRecord(output)
    event.remotePort = connection.record.port
    event.managed = connection.record.kind === 'managed'
    const localPort = await step(event, 'forward', () =>
      (options.localPort ?? reserveForwardPort)(ports.get(connection.name)),
    )
    ports.set(connection.name, localPort)
    event.localPort = localPort
    connection.controller.signal.throwIfAborted()
    const forward = await (options.forward ?? openForward)({
      spawn,
      target: machine.target,
      localPort,
      remotePort: connection.record.port,
    })
    connection.forward = forward
    void observeForward(connection, forward)
    publish(connection, { name: connection.name, phase: 'connecting' })
    const origin = `http://127.0.0.1:${localPort}`
    const descriptor = await step(event, 'readiness', () =>
      waitForDescriptor({
        child: forward.child,
        origin,
        webOrigin: options.webOrigin,
        signal: connection.controller.signal,
        fetcher: options.fetcher ?? fetch,
      }),
    )
    event.serverVersion = descriptor.serverVersion
    await step(event, 'protocol', async () => confirmProtocol(connection, descriptor))
    await step(event, 'identity', async () => confirmIdentity(connection, descriptor))
    connection.controller.signal.throwIfAborted()
    connection.preserveRemoteOnFailure = true
    publish(connection, { name: connection.name, phase: 'live', origin, localPort, descriptor })
    return descriptor
  }

  function confirmProtocol(connection: Connection, descriptor: HealthDescriptor) {
    if (descriptor.protocolVersion === ORCHESTRATION_WS_PROTOCOL_VERSION) return
    throw createSshProtocolError({
      expected: ORCHESTRATION_WS_PROTOCOL_VERSION,
      running: descriptor.protocolVersion,
      installed: null,
      installation: connection.installation?.kind ?? null,
      kind: connection.record?.kind ?? null,
      otherLeases: null,
      port: connection.record?.port ?? null,
      directory: connection.installation?.directory ?? null,
    })
  }

  function confirmIdentity(connection: Connection, descriptor: HealthDescriptor) {
    const expected = identities.get(connection.name) ?? connection.record?.environmentId
    if (
      expected !== descriptor.environmentId ||
      connection.record?.environmentId !== descriptor.environmentId
    )
      throw createSshError('identity')
    identities.set(connection.name, descriptor.environmentId)
  }

  function command(
    connection: Connection,
    machine: SshMachineDefinition,
    script: string,
    operation: SshCatalogStep,
    fix?: string,
  ) {
    return runSshCommand({
      spawn,
      target: machine.target,
      script,
      step: operation,
      signal: connection.controller.signal,
      fix,
    })
  }

  async function failed(connection: Connection, event: ConnectEvent, error: unknown) {
    const cancelled = connection.controller.signal.aborted
    const lastError = machineConnectionError(error, catalogStep(event.step))
    event.error = errorMessage(error)
    event.errorCode = lastError.code
    event.errorInternal = isEvlogError(error) ? error.internal : undefined
    if (lastError.code === 'machines.SSH_IDENTITY') event.step = 'identity'
    if (lastError.code === sshProtocolCode) event.step = 'protocol'
    event.outcome = cancelled ? 'cancelled' : 'failed'
    try {
      // A failed first connection releases its lease, so a refused server it alone held stops here.
      await (connection.preserveRemoteOnFailure
        ? closeConnectionForward(connection)
        : cleanup(connection))
    } catch (cleanupError) {
      event.cleanupError = errorMessage(cleanupError)
    }
    if (cancelled) return connection.state
    const phase = failurePhase(event.step)
    publish(connection, { name: connection.name, phase, lastError, lastErrorAt: Date.now() })
    return connection.state
  }

  async function observeForward(connection: Connection, forward: SshForward) {
    const child = forward.child
    const [, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (connection.forward !== forward || connection.controller.signal.aborted) return
    await forward.close()
    if (connection.forward !== forward || connection.controller.signal.aborted) return
    connection.forward = null
    if (connection.state.phase !== 'live') return
    const detail = `SSH forward exited (${exitCode}). ${stderr.trim().slice(0, 1000)}`.trim()
    const lastError = machineConnectionError(createSshError('forward', detail), 'forward')
    publish(connection, {
      name: connection.name,
      phase: 'offline',
      lastError,
      lastErrorAt: Date.now(),
    })
    writeLog(
      'machines.ssh.forward.exited',
      {
        machine: connection.name,
        target: connection.machine?.target,
        environmentId: identities.get(connection.name),
        localPort: ports.get(connection.name),
        exitCode,
      },
      true,
    )
  }

  function connectionClientId(connection: Connection) {
    return `${options.clientId}-${connection.name}`
  }

  async function cleanup(connection: Connection) {
    await closeConnectionForward(connection)
    if (!connection.machine || !connection.installation || !connection.remoteAttempted) return
    await runSshCommand({
      spawn,
      target: connection.machine.target,
      script: stopCommand(
        {
          installation: connection.installation,
          clientId: connectionClientId(connection),
        },
        connection.record,
      ),
      step: 'stop',
    })
    connection.remoteAttempted = false
    connection.record = null
  }

  async function closeConnectionForward(connection: Connection) {
    const forward = connection.forward
    connection.forward = null
    if (forward) await forward.close()
  }

  async function disconnectMachine(input: string) {
    const name = await parseMachineName(input)
    const running = disconnecting.get(name)
    if (running) return running
    connections.get(name)?.controller.abort()
    const operation = disconnect(name).finally(() => disconnecting.delete(name))
    disconnecting.set(name, operation)
    return operation
  }

  async function disconnect(name: string) {
    await pending.get(name)
    const connection = connections.get(name)
    if (!connection) return
    const startedAt = Date.now()
    try {
      await cleanup(connection)
      connections.delete(name)
      publish(connection, { name, phase: 'idle' })
      writeLog(
        'machines.ssh.disconnect',
        {
          machine: name,
          target: connection.machine?.target,
          environmentId: identities.get(name),
          step: 'stop',
          outcome: 'success',
          durationMs: Date.now() - startedAt,
        },
        false,
      )
    } catch (error) {
      publish(connection, {
        name,
        phase: 'offline',
        lastError: machineConnectionError(error, 'stop'),
        lastErrorAt: Date.now(),
      })
      writeLog(
        'machines.ssh.disconnect',
        {
          machine: name,
          target: connection.machine?.target,
          environmentId: identities.get(name),
          step: 'stop',
          outcome: 'failed',
          durationMs: Date.now() - startedAt,
          error: errorMessage(error),
        },
        true,
      )
      throw error
    }
  }

  async function close() {
    closing = true
    for (const connection of connections.values()) connection.controller.abort()
    await Promise.allSettled(Array.from(connections.keys(), disconnectMachine))
  }

  function stateFor(name: string): MachineConnectionState {
    return connections.get(name)?.state ?? { name, phase: 'idle' }
  }

  function listStates(): MachineConnectionState[] {
    return Array.from(connections.values(), (connection) => connection.state)
  }

  return { connectMachine, disconnectMachine, stateFor, listStates, close }
}

function changedRemote(previous: SshMachineDefinition, next: SshMachineDefinition) {
  return previous.target !== next.target || previous.remotePort !== next.remotePort
}

function failurePhase(step: SshErrorStep) {
  if (step === 'identity') return 'identity-drift'
  if (step === 'settings' || step === 'probe' || step === 'protocol') return 'blocked'
  return 'offline'
}

/** The catalog entry an uncoded failure falls back to; a protocol failure always arrives coded. */
function catalogStep(step: SshErrorStep): SshCatalogStep {
  return step === 'protocol' ? 'readiness' : step
}

function recordEvent(action: string, fields: Record<string, unknown>, failed: boolean) {
  if (failed) return recordProcessError(action, fields)
  recordProcessInfo(action, fields)
}
