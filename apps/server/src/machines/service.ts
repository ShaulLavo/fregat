import type { MachineConnectionState, Machines, SshMachineDefinition } from '@workspace/contracts'
import { createHash } from 'node:crypto'
import { recordProcessError } from '../observability/runtime'
import { createSshAuthentication } from './authentication'
import { MachineEvents } from './events'
import { createSshLauncher } from './launcher'
import { MachinePrompts } from './prompts'
import { parseMachineName } from './records'
import { createSshError } from './structured-errors'

type Launcher = ReturnType<typeof createSshLauncher>
type Authentication = Awaited<ReturnType<typeof createSshAuthentication>>
type ClientLifetime = { timer: ReturnType<typeof setTimeout> | null }
type Entry = {
  launcher: Launcher
  authentication: Authentication | null
  config: SshMachineDefinition
  owners: Set<string>
  authenticationOwner: { client: string } | null
  connecting: Promise<MachineConnectionState> | null
  cancelledAt: number | null
}

export type MachineServiceOptions = Pick<
  Parameters<typeof createSshLauncher>[0],
  'spawn' | 'fetcher' | 'localPort'
>

type Options = MachineServiceOptions & {
  environmentId: string
  webOrigin: string
  readMachines: () => Machines
}

export class MachineService {
  private readonly options: Options
  private readonly entries = new Map<string, Entry>()
  private readonly pending = new Map<string, Promise<Entry>>()
  private readonly disconnecting = new Map<string, Promise<void>>()
  private readonly retiring = new Map<string, Promise<void>>()
  private readonly owners = new Map<string, Set<string>>()
  private readonly events = new MachineEvents()
  private readonly clients = new Map<string, ClientLifetime>()
  private readonly prompts = new MachinePrompts((client, prompt) =>
    this.events.publish({ kind: 'auth', prompt }, client),
  )
  private closed = false

  constructor(options: Options) {
    this.options = options
  }

  async connect(input: string, client: string) {
    const name = await parseMachineName(input)
    this.assertOpen()
    this.renewClient(client)
    const owners = this.ownersFor(name)
    owners.add(client)
    let entry: Entry
    try {
      entry = await this.entry(name)
    } catch (error) {
      if (!owners.has(client)) return { name, phase: 'idle' as const }
      throw error
    }
    await this.disconnecting.get(name)
    this.assertOpen()
    if (!owners.has(client) || this.entries.get(name) !== entry)
      return { name, phase: 'idle' as const }
    const state = await this.connectEntry(name, entry, client)
    if (this.entries.get(name) !== entry || (!owners.has(client) && entry.cancelledAt === null))
      return { name, phase: 'idle' as const }
    return connectionState(entry, state)
  }

  async disconnect(input: string, client: string) {
    const name = await parseMachineName(input)
    return this.disconnectKnown(name, client)
  }

  private async disconnectKnown(name: string, client: string) {
    this.owners.get(name)?.delete(client)
    await this.pending.get(name)?.catch(() => undefined)
    const entry = this.entries.get(name)
    if (!entry) return this.retiring.get(name)
    if (entry.owners.size > 0) {
      this.transferAuthentication(name, entry, client)
      return
    }
    const running = this.disconnecting.get(name)
    if (running) return running
    const operation = this.disconnectEntry(name, entry, client).finally(() =>
      this.disconnecting.delete(name),
    )
    this.disconnecting.set(name, operation)
    return operation
  }

  private async disconnectEntry(name: string, entry: Entry, client: string) {
    const connecting = entry.connecting !== null
    if (connecting) entry.authentication?.cancel()
    if (!connecting && !this.closed && entry.cancelledAt === null) {
      entry.authentication?.begin()
    }
    this.prompts.cancelMachine(name)
    const owner = this.closed || connecting ? null : { client }
    entry.authenticationOwner = owner
    try {
      await entry.launcher.disconnectMachine(name)
    } finally {
      this.finishAuthentication(name, entry, owner)
    }
  }

  private connectEntry(name: string, entry: Entry, client: string) {
    if (entry.connecting) return entry.connecting
    entry.authentication?.begin()
    entry.cancelledAt = null
    const owner = { client }
    entry.authenticationOwner = owner
    const operation = entry.launcher.connectMachine(name).finally(() => {
      entry.connecting = null
      this.finishAuthentication(name, entry, owner)
    })
    entry.connecting = operation
    return operation
  }

  private finishAuthentication(name: string, entry: Entry, owner: Entry['authenticationOwner']) {
    if (entry.authenticationOwner !== owner) return
    entry.authenticationOwner = null
    this.prompts.cancelMachine(name)
  }

  private transferAuthentication(name: string, entry: Entry, previousClient: string) {
    if (entry.authenticationOwner?.client !== previousClient) return
    const nextClient = entry.owners.values().next().value
    if (!nextClient) return
    entry.authenticationOwner.client = nextClient
    this.prompts.reassign(name, previousClient, nextClient)
  }

  private ownersFor(name: string) {
    const existing = this.owners.get(name)
    if (existing) return existing
    const owners = new Set<string>()
    this.owners.set(name, owners)
    return owners
  }

  async respond(name: string, client: string, id: string, response: string | null) {
    const prompt = this.prompts.current(client)
    if (!prompt || prompt.name !== name || prompt.id !== id)
      throw createSshError('probe', 'This authentication prompt expired. Connect again.')
    const entry = this.entries.get(name)
    if (response === null && entry?.owners.has(client) && entry.owners.size > 1) {
      await this.disconnectKnown(name, client)
      return
    }
    this.prompts.respond(client, name, id, response)
    if (response === null) await this.disconnectKnown(name, client)
  }

  async *changes(client: string, signal: AbortSignal) {
    this.assertOpen()
    this.renewClient(client, true)
    const initial = [...this.entries.values()].flatMap((entry) =>
      entry.launcher
        .listStates()
        .map((state) => ({ kind: 'state' as const, state: connectionState(entry, state) })),
    )
    try {
      yield* this.events.subscribe(
        client,
        [...initial, { kind: 'auth', prompt: this.prompts.current(client) }],
        signal,
      )
    } finally {
      if (!this.closed && !this.events.hasClient(client)) this.renewClient(client)
    }
  }

  async resolve(input: string) {
    const name = await parseMachineName(input)
    const entry = this.entries.get(name)
    const config = this.options.readMachines()[name]
    const state = entry?.launcher.stateFor(name)
    if (!entry || !config || config.kind !== 'ssh' || !sameTarget(entry.config, config))
      throw createSshError('settings', 'This SSH machine is no longer configured with that target.')
    if (!state || state.phase !== 'live' || entry.cancelledAt !== null)
      throw createSshError('forward', 'Connect this machine before using it.')
    return { origin: state.origin, webOrigin: this.options.webOrigin }
  }

  async close() {
    if (this.closed) return
    this.closed = true
    for (const lifetime of this.clients.values()) {
      if (lifetime.timer) clearTimeout(lifetime.timer)
    }
    this.clients.clear()
    this.prompts.close()
    this.events.close()
    await Promise.allSettled(this.pending.values())
    await Promise.allSettled(this.retiring.values())
    await Promise.allSettled(this.disconnecting.values())
    await Promise.allSettled([...this.entries.values()].map((entry) => this.closeEntry(entry)))
    this.entries.clear()
    this.owners.clear()
  }

  async reconcile() {
    if (this.closed) return
    const machines = this.options.readMachines()
    for (const [name, owners] of this.owners) {
      if (machines[name]?.kind === 'ssh') continue
      owners.clear()
      this.owners.delete(name)
    }
    const operations: Promise<void>[] = []
    for (const [name, entry] of this.entries) {
      const config = machines[name]
      if (config?.kind === 'ssh' && sameTarget(entry.config, config)) continue
      operations.push(this.retireEntry(name, entry))
    }
    await Promise.all(operations)
    await Promise.allSettled(this.pending.values())
  }

  private async entry(name: string): Promise<Entry> {
    const pending = this.pending.get(name)
    if (pending) return pending
    const operation = this.prepareEntry(name).finally(() => this.pending.delete(name))
    this.pending.set(name, operation)
    return operation
  }

  private async prepareEntry(name: string): Promise<Entry> {
    await this.retiring.get(name)
    this.assertOpen()
    const config = this.options.readMachines()[name]
    if (!config || config.kind !== 'ssh') throw createSshError('settings')
    const previous = this.entries.get(name)
    if (previous && sameTarget(previous.config, config)) return previous
    if (previous) await this.retireEntry(name, previous)
    let entry: Entry | undefined
    const authentication = this.options.spawn
      ? null
      : await createSshAuthentication({
          onCancel: () => {
            if (entry) this.cancelAuthentication(name, entry)
          },
          request: (prompt) => {
            if (!entry?.authenticationOwner || this.closed) return Promise.resolve(null)
            return this.prompts.request(entry.authenticationOwner.client, { ...prompt, name })
          },
        })
    const current = this.options.readMachines()[name]
    if (this.closed || current?.kind !== 'ssh' || !sameTarget(config, current)) {
      await authentication?.close()
      return this.prepareEntry(name)
    }
    const launcher = createSshLauncher({
      ...this.options,
      clientId: createHash('sha256').update(this.options.environmentId).digest('hex').slice(0, 32),
      readMachines: async () => this.options.readMachines(),
      spawn: this.options.spawn ?? authentication?.spawn,
      forward: authentication?.openForward,
      publish: (state) => {
        if (entry && this.entries.get(name) === entry)
          this.events.publish({ kind: 'state', state: connectionState(entry, state) })
      },
    })
    entry = {
      launcher,
      authentication,
      config,
      owners: this.ownersFor(name),
      authenticationOwner: null,
      connecting: null,
      cancelledAt: null,
    }
    this.entries.set(name, entry)
    return entry
  }

  private cancelAuthentication(name: string, entry: Entry) {
    if (this.entries.get(name) !== entry) return
    entry.cancelledAt = Date.now()
    entry.owners.clear()
    entry.authenticationOwner = null
    this.prompts.cancelMachine(name)
    this.events.publish({
      kind: 'state',
      state: connectionState(entry, entry.launcher.stateFor(name)),
    })
  }

  private retireEntry(name: string, entry: Entry) {
    if (this.entries.get(name) !== entry) return this.retiring.get(name) ?? Promise.resolve()
    this.entries.delete(name)
    entry.authenticationOwner = null
    this.prompts.cancelMachine(name)
    this.events.publish({ kind: 'state', state: { name, phase: 'idle' } })
    const operation = this.closeRetiredEntry(name, entry).finally(() => {
      if (this.retiring.get(name) === operation) this.retiring.delete(name)
    })
    this.retiring.set(name, operation)
    return operation
  }

  private async closeRetiredEntry(name: string, entry: Entry) {
    await this.disconnecting.get(name)
    await this.closeEntry(entry)
  }

  private async closeEntry(entry: Entry) {
    await entry.launcher.close()
    await entry.authentication?.close()
  }

  private renewClient(client: string, subscribing = false) {
    const previous = this.clients.get(client)
    if (previous?.timer) clearTimeout(previous.timer)
    const lifetime: ClientLifetime = { timer: null }
    this.clients.set(client, lifetime)
    if (subscribing || this.events.hasClient(client)) return
    lifetime.timer = setTimeout(() => {
      lifetime.timer = null
      void this.releaseClient(client, lifetime)
    }, 30_000)
    lifetime.timer.unref()
  }

  private async releaseClient(client: string, lifetime: ClientLifetime) {
    for (const name of this.owners.keys()) {
      if (this.clients.get(client) !== lifetime || this.events.hasClient(client)) return
      try {
        await this.disconnectKnown(name, client)
      } catch (error) {
        recordProcessError('machines.ssh.release', { machine: name, error })
      }
    }
    if (this.clients.get(client) === lifetime) this.clients.delete(client)
  }

  private assertOpen() {
    if (this.closed) throw createSshError('settings', 'The backend is closing.')
  }
}

function connectionState(entry: Entry, state: MachineConnectionState): MachineConnectionState {
  if (entry.cancelledAt !== null)
    return {
      name: state.name,
      phase: 'blocked',
      lastError: 'SSH authentication was cancelled. Connect again to retry.',
      lastErrorAt: entry.cancelledAt,
    }
  if (state.phase !== 'live') return state
  return { ...state, origin: `/machines/${state.name}/proxy` }
}

function sameTarget(left: SshMachineDefinition, right: SshMachineDefinition) {
  return left.target === right.target && left.remotePort === right.remotePort
}
