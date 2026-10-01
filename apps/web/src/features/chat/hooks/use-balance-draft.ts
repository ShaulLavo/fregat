import { useEffect, useEffectEvent } from 'react'
import { useQueries } from '@tanstack/react-query'
import { log } from '@/lib/client-logging'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { useChatInputDraftStore, type ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { draftCanChangeMachine, type DraftMachine } from '../utils/draft-workspace'
import { chooseDraftMachine } from '../utils/machine-balancing'
import { machineCapacityQueryOptions } from '../utils/machine-capacity-query'
import { useMoveDraft } from './use-move-draft'

export function useBalanceDraft(
  target: ChatInputDraftTarget,
  machines: readonly DraftMachine[] | null,
) {
  const enabled = useSettingValue('environments.loadBalancing')
  const preferences = useSettingValue('environments.loadPreferences')
  const entries = useEnvironmentsStore((state) => state.entries)
  const draft = useChatInputDraftStore((state) => state.getDraft(target))
  const move = useMoveDraft(target)
  const unresolved =
    enabled &&
    machines !== null &&
    machines.length > 1 &&
    !!draft.identity &&
    !draft.identity.machineSelection &&
    draft.identity.worktreeTarget.kind === 'current' &&
    draftCanChangeMachine(draft) &&
    machines.some(
      (machine) =>
        machine.environmentId === target.environmentId &&
        machine.worktree?.id === draft.identity?.baseWorktreeId,
    )
  const candidates = (machines ?? []).filter(
    (machine) =>
      machine.phase === 'live' &&
      machine.worktree &&
      preferences[machine.environmentId] !== 'manual-only',
  )
  const queries = useQueries({
    queries: candidates.map((machine) => {
      const entry = Object.values(entries).find(
        (entry) => entry.environmentId === machine.environmentId,
      )
      return {
        ...machineCapacityQueryOptions(machine.environmentId, entry?.origin ?? ''),
        enabled: unresolved && !!entry,
      }
    }),
  })
  const pending = unresolved && queries.some((query) => query.isFetching)
  const failed = queries.some(
    (query) => query.fetchStatus === 'paused' || query.isError || !query.data,
  )
  const select = useEffectEvent(() => {
    const store = useChatInputDraftStore.getState()
    const current = store.getDraft(target)
    // A user choice can arrive between the query render and this effect.
    if (!current.identity || current.identity.machineSelection || !draftCanChangeMachine(current))
      return
    const decisionAt = Date.now()
    const chosen = failed
      ? null
      : chooseDraftMachine(
          candidates.map((machine, index) => ({
            environmentId: machine.environmentId,
            resources: queries[index]?.data ?? null,
            receivedAt: queries[index]?.dataUpdatedAt ?? 0,
            preference: preferences[machine.environmentId],
          })),
          decisionAt,
        )
    log.info({
      area: 'chat',
      action: 'chat.draft.capacity_choice',
      environmentId: target.environmentId,
      draftId: target.draftKey,
      outcome: chosen ? 'selected' : 'requires_choice',
      selectedEnvironmentId: chosen,
      reads: queries.map((query, index) => ({
        environmentId: candidates[index]?.environmentId,
        status: query.status,
        fetchStatus: query.fetchStatus,
        receiptAgeMs: decisionAt - query.dataUpdatedAt,
        cpuUtilization: query.data?.cpuUtilization ?? null,
        availableMemoryFraction: query.data
          ? query.data.availableMemoryBytes / query.data.totalMemoryBytes
          : null,
      })),
    })
    if (!chosen) {
      store.setIdentity(target, { ...current.identity, machineSelection: 'required' })
      return
    }
    const machine = candidates.find((candidate) => candidate.environmentId === chosen)
    if (!machine?.worktree) return
    const sourceIdentity = { ...current.identity, machineSelection: 'automatic' as const }
    store.setIdentity(target, sourceIdentity)
    if (machine.environmentId === target.environmentId) return
    move.mutate(
      { ...machine, worktree: machine.worktree, machineSelection: 'automatic', sourceIdentity },
      {
        onSuccess: (moved) => {
          if (moved) return
          const latest = store.getDraft(target)
          if (latest.identity === sourceIdentity)
            store.setIdentity(target, { ...latest.identity, machineSelection: 'required' })
        },
        onError: () => {
          const latest = store.getDraft(target)
          if (latest.identity === sourceIdentity)
            store.setIdentity(target, { ...latest.identity, machineSelection: 'required' })
        },
      },
    )
  })
  useEffect(() => {
    if (unresolved && !pending && !move.isPending) select()
  }, [unresolved, pending, failed, move.isPending])
  return {
    pending: pending || move.isPending,
    requiresChoice: draft.identity?.machineSelection === 'required',
  }
}
