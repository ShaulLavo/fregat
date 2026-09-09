import type { ClientOrchestrationCommand, EnvironmentId, SessionId } from '@workspace/contracts'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import {
  createProjectReorderCommand,
  createSessionPlaceCommand,
  createSessionReorderCommand,
} from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import {
  settleProjectOrder,
  settleSessionOrder,
  useRailOrderStore,
} from '@/features/chat-mode/state/rail-order-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import { railReorderIntent } from '@workspace/client-core/chat/rail/reorder'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
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
  useRailOrderStore.getState().placeProject(ref, intent.orderKey)
  void dispatchRailOrder({
    environmentId: ref.environmentId,
    command: createProjectReorderCommand({ projectId: ref.projectId, orderKey: intent.orderKey }),
    release: () => useRailOrderStore.getState().releaseProject(ref),
    settle: () => settleProjectOrder(ref, intent.orderKey),
  })
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
  useRailOrderStore.getState().placeSession(ref, intent.orderKey)
  void dispatchRailOrder({
    environmentId: ref.environmentId,
    command: sessionOrderCommand(ref.sessionId, intent.orderKey, active.pinOrderKey),
    release: () => useRailOrderStore.getState().releaseSession(ref),
    settle: () => settleSessionOrder(ref, intent.orderKey),
  })
}
function sessionOrderCommand(sessionId: SessionId, orderKey: string, current: string | null) {
  return current
    ? createSessionReorderCommand({ sessionId, orderKey })
    : createSessionPlaceCommand({ sessionId, orderKey })
}
async function dispatchRailOrder({
  environmentId,
  command,
  release,
  settle,
}: {
  readonly environmentId: EnvironmentId
  readonly command: ClientOrchestrationCommand
  readonly release: () => void
  readonly settle: () => void
}) {
  await dispatchChatCommand({
    action: 'chat.rail.reorder',
    command,
    dispatchCommand: (command) => dispatchCommandForEnvironment(environmentId, command),
    onAccepted: settle,
    onFailed: release,
  })
}
function railOrderModel() {
  return sessionRailModel({
    environments: currentRailEnvironments(),
    orderOverrides: useRailOrderStore.getState(),
    machineFilter: useSessionRailStore.getState().machineFilter,
    view: useSessionRailStore.getState().view,
  })
}
