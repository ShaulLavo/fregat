import type { EnvironmentId, OrchestrationWsServerConfig } from '@workspace/contracts'

export type EnvironmentPhase =
  | 'idle'
  | 'launching'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'offline'
  | 'blocked'
  | 'identity-drift'

export type EnvironmentEntry = {
  readonly origin: string
  readonly environmentId: EnvironmentId | null
  readonly label: string | null
  readonly kind: 'primary' | 'ssh' | 'origin'
  readonly name: string
  readonly phase: EnvironmentPhase
  readonly lastError: string | null
  readonly lastErrorAt: number | null
  readonly connectedAt: number | null
  readonly descriptor: import('@workspace/contracts').HealthDescriptor | null
  readonly localPort: number | null
}

type ConnectionMetadata = {
  readonly generation: number
  readonly protocolVersion: number | null
  readonly serverInstanceId: string | null
  readonly slowRequestCount: number
}

export type ServerConnectionState = ConnectionMetadata &
  (
    | { readonly phase: 'disconnected' | 'connected' }
    | { readonly phase: 'identity-drift'; readonly expected: string; readonly received: string }
    | { readonly phase: 'protocol-mismatch'; readonly expected: number; readonly received: number }
  )

export const initialServerConnection: ServerConnectionState = Object.freeze({
  generation: 0,
  phase: 'disconnected',
  protocolVersion: null,
  serverInstanceId: null,
  slowRequestCount: 0,
})

export function createEnvironmentEntry(origin: string, primaryOrigin: string): EnvironmentEntry {
  return {
    origin,
    environmentId: null,
    label: null,
    kind: origin === primaryOrigin ? 'primary' : 'origin',
    name: origin === primaryOrigin ? 'local' : origin,
    phase: 'idle',
    lastError: null,
    lastErrorAt: null,
    connectedAt: null,
    descriptor: null,
    localPort: null,
  }
}

export function connectionAfterHandshake(
  connection: ServerConnectionState,
  config: OrchestrationWsServerConfig,
): ServerConnectionState {
  const sameProcess = connection.serverInstanceId === config.serverInstanceId
  return {
    generation: connection.generation + (sameProcess ? 0 : 1),
    phase: 'connected',
    protocolVersion: config.protocolVersion,
    serverInstanceId: config.serverInstanceId,
    slowRequestCount: sameProcess ? connection.slowRequestCount : 0,
  }
}

export function connectionAfterDescriptor(
  connection: ServerConnectionState,
): ServerConnectionState {
  if (connection.phase === 'connected' || connection.phase === 'disconnected') return connection

  return {
    generation: connection.generation,
    phase: 'disconnected',
    protocolVersion: connection.protocolVersion,
    serverInstanceId: connection.serverInstanceId,
    slowRequestCount: connection.slowRequestCount,
  }
}

export function selectServerProtocolSkew(
  connection: Pick<ServerConnectionState, 'protocolVersion'>,
  expected: number,
): boolean {
  return connection.protocolVersion !== null && connection.protocolVersion !== expected
}
