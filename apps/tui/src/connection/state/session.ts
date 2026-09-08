import { createChatOwner, type ChatOwner } from '@workspace/client-core/chat/owner'
import { readEnvironmentDescriptor } from '@workspace/client-core/environments/descriptor'
import { createEnvironmentsStore } from '@workspace/client-core/environments/state/store'
import { readSettings } from '@workspace/client-core/settings/read'
import { createSettingsOwner, type SettingsOwner } from '@workspace/client-core/settings/owner'
import { canonicalServerOrigin, type Client } from '@workspace/client-core/transport/client'
import {
  OrchestrationRpcClient,
  type OrchestrationRpcClientOptions,
} from '@workspace/client-core/transport/orchestration-rpc-client'
import type { HealthDescriptor, SettingsSnapshot } from '@workspace/contracts'

import { connectionFailure, type ConnectionFailure } from '@/connection/utils/failure'
import { openFileStorage, type FileStorage } from '@/storage/files'
import type { ServiceSocket } from '@/connection/utils/service-socket'
import { ensureWorktree } from '@/connection/state/worktree'
import { createTuiError } from '@/host/utils/structured-errors'

export type SessionState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly failure: ConnectionFailure }
  | {
      readonly kind: 'ready'
      readonly descriptor: HealthDescriptor
      readonly settings: SettingsSnapshot
      readonly owner: SettingsOwner
      readonly chat: ChatOwner
      readonly storage: Awaited<ReturnType<typeof openFileStorage>>
      readonly connection:
        | { readonly kind: 'live' }
        | { readonly kind: 'offline'; readonly failure: ConnectionFailure }
    }

type SessionOptions = Pick<OrchestrationRpcClientOptions, 'createSocket' | 'observation'> & {
  readonly origin: string
  readonly client: Client
  readonly storageDirectory: string
  readonly record?: (event: Record<string, unknown>) => void
  readonly createServiceSocket?: (url: string) => ServiceSocket
}

export type SettingsSession = ReturnType<typeof createSettingsSession>

export function createSettingsSession(options: SessionOptions) {
  const origin = canonicalServerOrigin(options.origin)
  const environments = createEnvironmentsStore({ primaryOrigin: origin })
  const listeners = new Set<() => void>()
  const lifetime = new AbortController()
  let state: SessionState = { kind: 'loading' }
  let current: AbortController | null = null
  let currentRpc: OrchestrationRpcClient | null = null
  let currentOwner: SettingsOwner | null = null
  let currentChat: ChatOwner | null = null
  let storage: ReturnType<typeof openFileStorage> | null = null
  let savedStorage: FileStorage | null = null

  function publish(next: SessionState) {
    if (lifetime.signal.aborted) return
    state = next
    for (const listener of listeners) listener()
  }

  async function refresh() {
    if (lifetime.signal.aborted) return
    current?.abort()
    currentChat?.dispose()
    currentRpc?.close()
    currentOwner?.dispose()
    const controller = new AbortController()
    current = controller
    const httpSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
    const started = performance.now()
    publish({ kind: 'loading' })
    try {
      const descriptor = await readEnvironmentDescriptor({
        origin,
        client: options.client,
        environments,
        signal: httpSignal,
      })
      const settings = await readSettings({ client: options.client, signal: httpSignal })
      httpSignal.throwIfAborted()
      let connectionError: unknown = null
      const rpc = new OrchestrationRpcClient({
        origin,
        environments,
        createSocket: options.createSocket,
        observation: options.observation,
        onDisconnect(error) {
          connectionError = error
          disconnected(controller, error)
        },
      })
      currentRpc = rpc
      controller.signal.addEventListener('abort', () => rpc.close(), { once: true })
      await rpc.ready()
      controller.signal.throwIfAborted()
      if (connectionError) throw connectionError
      storage ??= openFileStorage(options.storageDirectory, descriptor.environmentId)
        .then((saved) => {
          savedStorage = saved
          if (lifetime.signal.aborted) saved.close()
          return saved
        })
        .catch((error: unknown) => {
          storage = null
          throw error
        })
      const saved = await storage
      controller.signal.throwIfAborted()
      if (connectionError) throw connectionError
      const owner = createSettingsOwner({
        client: options.client,
        initialSnapshot: settings,
        instanceId: `tui-settings-${crypto.randomUUID()}`,
        record: options.record,
      })
      currentOwner = owner
      const chat = createChatOwner({ client: options.client, rpc, record: options.record })
      currentChat = chat
      controller.signal.addEventListener('abort', () => chat.dispose(), { once: true })
      controller.signal.addEventListener('abort', () => owner.dispose(), { once: true })
      owner.subscribe(() => {
        if (controller.signal.aborted || state.kind !== 'ready') return
        publish({ ...state, settings: owner.getSnapshot().snapshot })
      })
      publish({
        kind: 'ready',
        descriptor,
        settings,
        owner,
        chat,
        storage: saved,
        connection: { kind: 'live' },
      })
      owner.start()
      chat.start()
      options.record?.({
        origin,
        outcome: 'live',
        environmentId: descriptor.environmentId,
        protocolVersion: descriptor.protocolVersion,
        durationMs: performance.now() - started,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      currentChat?.dispose()
      currentRpc?.close()
      const failure = connectionFailure(error)
      publish({ kind: 'failed', failure })
      options.record?.({
        origin,
        outcome: 'failed',
        code: failure.code,
        durationMs: performance.now() - started,
      })
    }
  }

  function disconnected(controller: AbortController, error: unknown) {
    if (controller.signal.aborted || lifetime.signal.aborted || state.kind !== 'ready') return
    currentOwner?.pause()
    currentChat?.dispose()
    publish({ ...state, connection: { kind: 'offline', failure: connectionFailure(error) } })
  }

  return {
    origin,
    signal: lifetime.signal,
    client: options.client,
    createServiceSocket(url: string) {
      lifetime.signal.throwIfAborted()
      if (!options.createServiceSocket)
        throw createTuiError(
          'Service sockets are unavailable.',
          'Provide a service socket factory to this TUI host.',
        )
      return options.createServiceSocket(url)
    },
    async ensureWorktree(rootPath: string) {
      lifetime.signal.throwIfAborted()
      if (!currentRpc || state.kind !== 'ready' || state.connection.kind !== 'live')
        throw createTuiError(
          'The environment is disconnected.',
          'Reconnect before opening a terminal.',
        )
      return ensureWorktree({
        client: options.client,
        rpc: currentRpc,
        rootPath,
        signal: lifetime.signal,
      })
    },
    record: (event: Record<string, unknown>) => options.record?.(event),
    refresh,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      if (lifetime.signal.aborted) return
      lifetime.abort()
      current?.abort()
      currentChat?.dispose()
      currentRpc?.close()
      currentOwner?.dispose()
      listeners.clear()
      savedStorage?.close()
    },
    async flush() {
      const saved = await storage
      await saved?.flush()
    },
  }
}
