import { createStore } from 'zustand/vanilla'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import {
  orchestrationDispatchResultSchema,
  orchestrationShellSnapshotSchema,
  type ClientOrchestrationCommand,
} from '@workspace/contracts'
import * as v from 'valibot'
import { environmentClientFor } from '@/lib/client'
import { confirmedEnvironmentId, confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { unwrapEdenResponse } from '@/lib/eden-events'
import type { EnvironmentId } from '@workspace/contracts'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'

/** The live transport per environment; a replaced one is closed before it leaves. */
export const activeTransports = createStore<ReadonlyMap<EnvironmentId, ChatTransport>>(
  () => new Map(),
)

export function transportFor(environmentId: EnvironmentId) {
  return activeTransports.getState().get(environmentId) ?? null
}

export function registerChatTransport(transport: ChatTransport) {
  const held = transportFor(transport.environmentId)
  if (held && held !== transport) held.close()
  activeTransports.setState(
    new Map(activeTransports.getState()).set(transport.environmentId, transport),
    true,
  )
  return () => {
    if (transportFor(transport.environmentId) !== transport) return
    transport.close()
  }
}

export function closeChatTransports() {
  for (const transport of activeTransports.getState().values()) transport.close()
  activeTransports.setState(new Map(), true)
}

export async function dispatchCommandForEnvironment(
  environmentId: EnvironmentId,
  command: ClientOrchestrationCommand,
) {
  const origin = confirmedEnvironmentOrigin(environmentId)
  const live = transportFor(environmentId)
  if (live) return live.dispatchCommand(command)
  const client = environmentClientFor(origin)
  const response = await client.orchestration.commands.post(command)
  confirmedEnvironmentId(origin)
  const receipt = v.parse(
    orchestrationDispatchResultSchema,
    unwrapEdenResponse(response, {
      requireData: true,
      normalizeDates: true,
      emptyMessage: 'The session command returned no receipt.',
    }),
  )
  if (
    Array.from(activeTransports.getState().values()).some(
      (transport) => transport.environmentId === environmentId && !transport.closed,
    )
  )
    return receipt

  const snapshotResponse = await client.orchestration['shell-snapshot'].get()
  const snapshot = v.parse(
    orchestrationShellSnapshotSchema,
    unwrapEdenResponse(snapshotResponse, {
      requireData: true,
      normalizeDates: true,
      emptyMessage: 'The session machine returned no workspace snapshot.',
    }),
  )
  confirmedEnvironmentId(origin)
  useChatProjectionStore.getState().syncShellSnapshot(environmentId, snapshot)
  return receipt
}
