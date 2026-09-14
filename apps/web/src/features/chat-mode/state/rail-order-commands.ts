import type { ClientOrchestrationCommand, SessionId } from '@workspace/contracts'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import {
  createProjectReorderCommand,
  createSessionPlaceCommand,
  createSessionReorderCommand,
} from '@workspace/client-core/chat/commands'
import { runIntent, type AcknowledgementSource } from '@workspace/client-core/optimistic/run'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import {
  railOrderIntents,
  railOrderOverrides,
  railPlacementResource,
  type RailPlacement,
} from '@/features/chat-mode/state/rail-order-intents'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { railReorderIntent } from '@workspace/client-core/chat/rail/reorder'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import { log } from '@/lib/client-logging'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { runMutation } from '@/lib/mutations/run'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'

type Drop = { readonly activeId: string; readonly overId: string | null }

export function reorderRailProject({ activeId, overId }: Drop) {
  const model = railOrderModel()
  const active = model.groups.find((group) => group.key === activeId)?.project
  const over = model.groups.find((group) => group.key === overId)?.project
  if (!active || !over) return
  const intent = railReorderIntent({
    activeId: active.key,
    overId: over.key,
    rows: model.projects.map((project) => ({ id: project.key, orderKey: project.orderKey })),
  })
  if (!intent) return

  const ref = active.ref
  void placeRailRow(
    { kind: 'project', ref, orderKey: intent.orderKey },
    createProjectReorderCommand({ projectId: ref.projectId, orderKey: intent.orderKey }),
    (state) =>
      selectChatProjectionSlice(state, ref.environmentId).projectById[ref.projectId]?.orderKey ??
      null,
  )
}

export function reorderRailSession({ activeId, overId }: Drop) {
  const sessions = railOrderModel().sessions
  const active = sessions.find((session) => session.key === activeId)
  const over = sessions.find((session) => session.key === overId)
  if (
    !active ||
    !over ||
    active.archived ||
    active.environmentId !== over.environmentId ||
    active.projectId !== over.projectId ||
    active.status !== over.status
  )
    return
  const owned = sessions.filter(
    (session) =>
      session.environmentId === active.environmentId &&
      session.projectId === active.projectId &&
      session.status === active.status,
  )
  const intent = railReorderIntent({
    activeId,
    overId,
    rows: owned.map((session) => ({ id: session.key, orderKey: session.pinOrderKey })),
  })
  if (!intent) return

  const ref = active.ref
  void placeRailRow(
    { kind: 'session', ref, orderKey: intent.orderKey },
    sessionOrderCommand(ref.sessionId, intent.orderKey, active.pinOrderKey),
    (state) =>
      selectChatProjectionSlice(state, ref.environmentId).sessionById[ref.sessionId]?.pinOrderKey ??
      null,
  )
}

function sessionOrderCommand(sessionId: SessionId, orderKey: string, current: string | null) {
  return current
    ? createSessionReorderCommand({ sessionId, orderKey })
    : createSessionPlaceCommand({ sessionId, orderKey })
}

type ProjectedOrderKey = (
  state: ReturnType<typeof useChatProjectionStore.getState>,
) => string | null

/**
 * The row moves now and stays moved until the server's projection carries the
 * key, which is the acknowledgement; the dispatch response alone only proves
 * the command was accepted. A refused dispatch or a projection that never
 * catches up withdraws the placement.
 */
function placeRailRow(
  placement: RailPlacement,
  command: ClientOrchestrationCommand,
  projectedOrderKey: ProjectedOrderKey,
) {
  const until: AcknowledgementSource = {
    subscribe: useChatProjectionStore.subscribe,
    satisfied: () => projectedOrderKey(useChatProjectionStore.getState()) === placement.orderKey,
  }

  return runMutation(
    queryClientFor(confirmedEnvironmentOrigin(placement.ref.environmentId)),
    {
      mutationFn: () =>
        runIntent(railOrderIntents, placement, {
          resources: [railPlacementResource(placement)],
          perform: async () => {
            const outcome = await dispatchChatCommand({
              action: 'chat.rail.reorder',
              command,
              dispatchCommand: (dispatched) =>
                dispatchCommandForEnvironment(placement.ref.environmentId, dispatched),
            })
            if (!outcome.ok) throw outcome.error
            return outcome.result
          },
          until,
          record: (event) =>
            log[event.outcome === 'acknowledged' ? 'debug' : 'warn']({
              action: 'chat.rail.reorder.intent',
              area: 'chat-rail',
              kind: placement.kind,
              ...event,
            }),
        }),
      mutationKey: chatModeMutationKeys.railOrder(placement.ref.environmentId),
    },
    undefined,
  )
}

function railOrderModel() {
  return sessionRailModel({
    environments: currentRailEnvironments(),
    orderOverrides: railOrderOverrides(),
    machineFilter: useSessionRailStore.getState().machineFilter,
    view: useSessionRailStore.getState().view,
  })
}
