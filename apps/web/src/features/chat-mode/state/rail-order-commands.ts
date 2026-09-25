import { scopedSessionKey } from '@workspace/contracts'
import { planRailDrop, resolveRailDropTarget } from '@workspace/client-core/chat/rail/drop'
import {
  railDropItems,
  sessionDropPatch,
  type SessionDropPatch,
} from '@/features/chat-mode/utils/rail-drop'
import {
  canonicalShelf,
  dropEntryAcknowledged,
  dropEntryConflicts,
} from '@/features/chat-mode/utils/rail-drop-state'
import { railOrderErrors } from '@/features/chat-mode/utils/rail-order-errors'
import { currentSessionLifecyclePolicy } from '@/features/chat-mode/state/session-lifecycle'
import { useSessionSearchStore } from '@/features/chat-mode/state/session-search-store'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import type { ClientOrchestrationCommand } from '@workspace/contracts'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { createProjectReorderCommand } from '@workspace/client-core/chat/commands'
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
import {
  sessionLifecycleUndoEntry,
  type SessionLifecycleUndoEntry,
} from '@workspace/client-core/chat/rail/lifecycle-undo'
import { forgetSessionUndo, offerSessionUndo } from '@/features/chat-mode/state/session-undo'
import { dropUndoKind } from '@/features/chat-mode/utils/session-undo'

type Drop = { readonly activeId: string; readonly overId: string | null }
type SessionDrop = Drop & {
  /** The Undo key named on the notice a settling or unpinning drop offers. */
  readonly undoShortcut?: string | null
}

export function reorderRailProject({ activeId, overId }: Drop) {
  const model = railOrderModel()
  const active = model.groups.find((group) => group.key === activeId)?.project
  const over = model.groups.find((group) => group.key === overId)?.project
  if (!active || !over || active.members.length !== 1 || over.members.length !== 1) return
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

export function reorderRailSession({ activeId, overId, undoShortcut }: SessionDrop) {
  if (!overId) return
  const environments = currentRailEnvironments()
  const model = railOrderModel()
  const active = model.sessions.find((session) => session.key === activeId)
  if (!active || !active.canDrag || active.archived) return
  const over = model.sessions.find((session) => session.key === overId)
  if (over && over.projectGroupKey !== active.projectGroupKey) return
  const visible = model.groups
    .flatMap((group) => group.sessions)
    .filter((session) => session.projectGroupKey === active.projectGroupKey)
  const target = resolveRailDropTarget(railDropItems(visible), activeId, overId)
  if (!target) return
  const owner = environments.find(
    (environment) => environment.environmentId === active.environmentId,
  )
  const policy = currentSessionLifecyclePolicy(active.ref)
  if (target.section === 'settled' && (!policy.settlement || policy.settleBlocked)) return
  if (target.section === 'pinned' && !policy.pinning) return
  if (target.section === 'active' && !owner?.capabilities?.sessionActiveReorder) return
  if (target.section === 'active' && active.pinnedAt && !policy.pinning) return
  if (active.placement === 'snoozed' && !policy.snooze) return
  const retained = environments.flatMap((environment) =>
    environment.sessions.map((session) => ({
      key: scopedSessionKey({ environmentId: environment.environmentId, sessionId: session.id }),
      pinOrderKey: session.pinOrderKey,
      activeOrderKey: session.activeOrderKey,
    })),
  )
  const capable = (capability: 'sessionPinReorder' | 'sessionActiveReorder') =>
    new Set(
      visible
        .filter((row) => {
          const environment = environments.find(
            (candidate) => candidate.environmentId === row.environmentId,
          )
          if (environment?.phase !== 'live' || !environment.capabilities?.[capability]) return false
          return capability !== 'sessionPinReorder' || environment.capabilities.sessionPinning
        })
        .map((row) => row.key),
    )
  const plan = planRailDrop({
    activeKey: activeId,
    activeSection: active.placement,
    activePinned: Boolean(active.pinnedAt),
    activeSettled: active.settledOverride === 'settled',
    supportsSettlement: policy.settlement,
    target,
    pinnedOrder: visible.filter((row) => row.placement === 'pinned').map((row) => row.key),
    activeOrder: visible.filter((row) => row.placement === 'active').map((row) => row.key),
    pinnedKeysById: new Map(retained.map((row) => [row.key, row.pinOrderKey])),
    activeKeysById: new Map(retained.map((row) => [row.key, row.activeOrderKey])),
    reorderableKeys: capable('sessionPinReorder'),
    activeReorderableKeys: capable('sessionActiveReorder'),
  })
  const patch = sessionDropPatch(
    active,
    plan,
    new Map(model.sessions.map((row) => [row.key, row])),
    new Date().toISOString(),
  )
  if (!patch || !patch.commands.length) return
  const kind = dropUndoKind(plan)
  return performSessionDrop(patch).then((outcome) => {
    if (!outcome.ok) return outcome
    if (!kind) return outcome
    offerSessionUndo({
      kind,
      entries: outcome.result ? [{ ...outcome.result, reopen: null }] : [],
      detail: '',
      shortcut: undoShortcut ?? null,
    })
    return outcome
  })
}

function performSessionDrop(patch: SessionDropPatch) {
  return runMutation(
    queryClientFor(confirmedEnvironmentOrigin(patch.ref.environmentId)),
    {
      mutationKey: chatModeMutationKeys.railOrder(patch.ref.environmentId),
      scope: { id: 'chat.rail.drop' },
      mutationFn: async () => {
        const abort = new AbortController()
        const read = (ref: SessionDropPatch['ref']) =>
          selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId)
            .sessionById[ref.sessionId]
        const unsubscribe = useChatProjectionStore.subscribe(() => {
          if (patch.entries.some((entry) => dropEntryConflicts(patch, entry, read(entry.ref))))
            abort.abort(
              railOrderErrors.DROP_CHANGED({ internal: { entryCount: patch.entries.length } }),
            )
        })
        try {
          return await runIntent(railOrderIntents, patch, {
            resources: patch.entries.map((entry) => `session:${entry.key}`),
            signal: abort.signal,
            perform: async () => {
              let undo: SessionLifecycleUndoEntry | null = null
              let interleaved = false
              for (const step of patch.commands) {
                abort.signal.throwIfAborted()
                const outcome = await dispatchChatCommand({
                  action: 'chat.rail.drop',
                  command: step.command,
                  dispatchCommand: (command) =>
                    dispatchCommandForEnvironment(step.ref.environmentId, command),
                })
                if (!outcome.ok) throw outcome.error
                forgetSessionUndo([step.ref])
                if (scopedSessionKey(step.ref) !== scopedSessionKey(patch.ref)) continue
                const next = sessionLifecycleUndoEntry(step.ref, outcome.result)
                if (!next) continue
                if (undo && next.restoreRevision !== undo.expectedRevision) interleaved = true
                undo = appendLifecycleReceipt(undo, next)
              }
              return interleaved ? null : undo
            },
            until: {
              subscribe: useChatProjectionStore.subscribe,
              satisfied: () =>
                patch.entries.every((entry) => dropEntryAcknowledged(entry, read(entry.ref))) &&
                canonicalShelf(read(patch.ref)!) === patch.destination,
            },
            record: (event) =>
              log[event.outcome === 'acknowledged' ? 'debug' : 'warn']({
                action: 'chat.rail.drop.intent',
                area: 'chat-rail',
                ...event,
              }),
          })
        } finally {
          unsubscribe()
        }
      },
    },
    undefined,
  )
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
  placement: Extract<RailPlacement, { kind: 'project' }>,
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
  const settings = readSettingsMirror()
  const rail = useSessionRailStore.getState()
  const search = useSessionSearchStore.getState()
  return sessionRailModel({
    query: rail.query,
    scope: rail.scope,
    collapsedProjectIds: rail.collapsedProjectIds,
    searchMatches: search.matchedQuery === rail.query.trim() ? search.matchBySessionKey : {},
    grouping: {
      mode: settings['chat.projectGrouping'],
      overrides: settings['chat.projectGroupingOverrides'],
    },
    environments: currentRailEnvironments(),
    orderOverrides: railOrderOverrides(),
    machineFilter: useSessionRailStore.getState().machineFilter,
    view: useSessionRailStore.getState().view,
  })
}

function appendLifecycleReceipt(
  previous: SessionLifecycleUndoEntry | null,
  next: SessionLifecycleUndoEntry,
): SessionLifecycleUndoEntry {
  return previous ? { ...previous, expectedRevision: next.expectedRevision } : next
}
