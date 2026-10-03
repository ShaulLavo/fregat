import { sameUpdateTarget, type SessionId } from '@workspace/contracts'
import {
  newerUpdateTarget,
  releaseReadyForReload,
} from '@/features/server-update/utils/release-ready'
import { selectServerConnection } from '@workspace/client-core/environments/state/store'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { primaryServerOrigin } from '@/lib/client'
import { serverUpdateQueryKeys } from '@/features/server-update/utils/query-keys'
import { useMutation } from '@tanstack/react-query'
import { use, useEffect, useEffectEvent, useState } from 'react'
import { useStore } from 'zustand'

import { useRelease } from '@/features/server-update/hooks/use-release'
import { useRestart } from '@/features/server-update/hooks/use-restart'
import { useServerUpdate } from '@/features/server-update/hooks/use-server-update'
import { updateIntentStore, type UpdateTarget } from '@/features/server-update/state/intent'
import { reconcileUpdateIntent } from '@/features/server-update/utils/reconcile-intent'
import { updateRestartTimeoutMs } from '@/features/server-update/utils/restart-timeout'
import { useSettingValue } from '@/hooks/use-setting-value'
import { serverUpdateMutationKeys } from '@/features/server-update/utils/mutation-keys'
import { notifyMutationError } from '@/features/server-update/utils/notify-mutation-error'
import { isRestartDisconnect } from '@/features/server-update/utils/restart-outcome'
import { sameBusySessions } from '@/features/server-update/utils/busy-sessions'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import {
  ReloadSafetyContext,
  createReloadSafetyStore,
  type ReloadSafetyStore,
} from '@/lib/reload-safety'

const EMPTY_SAFETY = createReloadSafetyStore()
const NO_BUSY = [] as const
const reloadPage = () => window.location.reload()

export function useUpdateApp({
  safety,
  reload = reloadPage,
}: {
  readonly safety?: ReloadSafetyStore
  readonly reload?: () => void
}) {
  const context = use(ReloadSafetyContext)
  const safetyStore = safety ?? context ?? EMPTY_SAFETY
  const dirtyFiles = useStore(safetyStore, (state) => state.dirtyFiles)
  const intent = useStore(updateIntentStore, (state) => state.intent)
  const setIntent = updateIntentStore.getState().setIntent
  const [loadedRelease] = useState(
    () => document.querySelector<HTMLMetaElement>('meta[name="platform-release"]')?.content ?? null,
  )
  const query = useRelease()
  const pushed = useServerUpdate()
  const data = query.data
  const pending = data?.pending
  const busy = data?.busy ?? NO_BUSY
  const connection = useEnvironmentsStore((state) =>
    selectServerConnection(state, primaryServerOrigin()),
  )
  const restart = useRestart()
  const activationSeconds = useSettingValue('server.activationTimeoutSeconds')
  const recoveryTimeoutMs = updateRestartTimeoutMs(activationSeconds)
  const pageTarget: UpdateTarget | null =
    loadedRelease && data?.release && loadedRelease !== data.release
      ? { release: data.release, stagedAt: null }
      : null
  const available = pending ?? pageTarget
  const currentTarget = intent.kind === 'idle' ? available : intent.target

  function observe(target: UpdateTarget) {
    setIntent({
      kind: 'restarting',
      target,
      confirmed: true,
      instance: connection.serverInstanceId,
      fromRelease: data?.server.release ?? null,
      startedAt: Date.now(),
    })
    void primaryQueryClient().invalidateQueries({ queryKey: serverUpdateQueryKeys.release() })
  }

  function send(target: UpdateTarget, interrupt: SessionId[], waiting: boolean) {
    if (target.stagedAt === null) {
      setIntent({ kind: 'reload', target })
      return
    }
    const instance = connection.serverInstanceId
    const fromRelease = data?.server.release ?? null
    const startedAt = Date.now()
    setIntent({ kind: 'restarting', target, confirmed: false, instance, fromRelease, startedAt })
    restart.mutate(
      { target, interrupt },
      {
        onSuccess: (answer) => {
          const current = updateIntentStore.getState().intent
          if (
            current.kind !== 'restarting' ||
            current.startedAt !== startedAt ||
            !sameUpdateTarget(current.target, target)
          )
            return
          if (answer.restarting)
            setIntent({
              kind: 'restarting',
              target,
              confirmed: true,
              instance,
              fromRelease,
              startedAt,
            })
          else if (waiting)
            setIntent({
              kind: 'waiting',
              target,
              busy: answer.busy,
              gateReadAt:
                primaryQueryClient().getQueryState(serverUpdateQueryKeys.release())
                  ?.dataUpdatedAt ?? 0,
            })
          else setIntent({ kind: 'confirm', target, busy: answer.busy })
        },
        onError: (error) => {
          const current = updateIntentStore.getState().intent
          if (
            current.kind !== 'restarting' ||
            current.startedAt !== startedAt ||
            !sameUpdateTarget(current.target, target)
          )
            return
          if (isRestartDisconnect(error))
            setIntent({
              kind: 'restarting',
              target,
              confirmed: false,
              instance,
              fromRelease,
              startedAt,
            })
          else {
            setIntent({ kind: 'failed', target, reason: 'request' })
            notifyMutationError(error)
          }
        },
      },
    )
  }

  // Navigation is an effect with TanStack-owned in-flight state; every execution rechecks dirty buffers.
  const navigation = useMutation(
    {
      mutationKey: serverUpdateMutationKeys.reload(),
      scope: { id: 'server-update.reload' },
      retry: false,
      mutationFn: async (target: UpdateTarget) => {
        if (safetyStore.getState().dirtyFiles.length > 0) return
        const latest = primaryQueryClient().getQueryData<NonNullable<typeof data>>(
          serverUpdateQueryKeys.release(),
        )
        if (!latest || !releaseReadyForReload(latest, target)) return
        const announced = useEnvironmentsStore.getState().updateByOrigin[primaryServerOrigin()]
        if (newerUpdateTarget(announced?.pending, target)) return
        const current = updateIntentStore.getState().intent
        if (current.kind !== 'reload' || !sameUpdateTarget(current.target, target)) return
        setIntent({ kind: 'idle' })
        reload()
      },
    },
    primaryQueryClient(),
  )

  const reconcile = useEffectEvent(() => {
    if (intent.kind === 'idle' || !data) return
    const target = intent.target
    if (intent.kind === 'restarting' && query.dataUpdatedAt < intent.startedAt) return
    const disposition = reconcileUpdateIntent(intent, data)
    if (disposition === 'superseded' || disposition === 'gone') {
      setIntent({ kind: 'idle' })
      return
    }
    if (newerUpdateTarget(pushed?.pending, target)) {
      setIntent({ kind: 'idle' })
      return
    }
    const healthy = releaseReadyForReload(data, target)
    if (
      (intent.kind === 'restarting' || intent.kind === 'reload') &&
      target.stagedAt !== null &&
      data.liveCheck?.release === target.release &&
      data.liveCheck.status === 'failed' &&
      Date.parse(data.liveCheck.at) >= Date.parse(target.stagedAt)
    ) {
      setIntent({ kind: 'failed', target, reason: 'health-check' })
      return
    }
    if (intent.kind === 'restarting') {
      if (healthy) setIntent({ kind: 'reload', target })
      return
    }
    if (intent.kind === 'reload') {
      if (dirtyFiles.length > 0) return
      if (!healthy && target.stagedAt !== null) {
        observe(target)
        return
      }
      if (healthy && !navigation.isPending) navigation.mutate(target)
      return
    }
    if (intent.kind === 'failed') {
      if (intent.reason === 'health-check' && healthy) setIntent({ kind: 'reload', target })
      return
    }
    if (intent.kind !== 'waiting') return
    if (disposition === 'served') {
      if (dirtyFiles.length > 0 || (target.stagedAt !== null && busy.length > 0)) return
      if (healthy) setIntent({ kind: 'reload', target })
      else if (target.stagedAt !== null) observe(target)
      return
    }
    if (dirtyFiles.length === 0 && busy.length === 0 && query.dataUpdatedAt > intent.gateReadAt) {
      if (restart.isPending) observe(target)
      else send(target, [], true)
      return
    }
    if (!sameBusySessions(intent.busy, busy)) setIntent({ ...intent, busy })
  })

  const expireRestart = useEffectEvent((target: UpdateTarget, startedAt: number) => {
    const current = updateIntentStore.getState().intent
    if (
      current.kind !== 'restarting' ||
      current.startedAt !== startedAt ||
      !sameUpdateTarget(current.target, target)
    )
      return
    setIntent({
      kind: 'failed',
      target,
      reason: query.isError || connection.phase !== 'connected' ? 'unreachable' : 'timeout',
    })
  })

  useEffect(() => {
    if (intent.kind !== 'restarting') return
    const timer = window.setTimeout(
      () => expireRestart(intent.target, intent.startedAt),
      Math.max(0, intent.startedAt + recoveryTimeoutMs - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [intent, recoveryTimeoutMs])

  useEffect(() => {
    void primaryQueryClient().invalidateQueries({ queryKey: serverUpdateQueryKeys.release() })
  }, [pushed, connection.phase, connection.serverInstanceId])

  useEffect(() => {
    reconcile()
  }, [
    intent,
    data,
    pending,
    dirtyFiles,
    restart.isPending,
    navigation.isPending,
    query.dataUpdatedAt,
  ])

  function request() {
    const target = intent.kind === 'failed' ? intent.target : available
    if (intent.kind === 'reload' || intent.kind === 'restarting' || !target) return
    if (
      intent.kind === 'failed' &&
      target.stagedAt !== null &&
      (!data || !sameUpdateTarget(pending, target))
    ) {
      observe(target)
      return
    }
    if (!data) return
    if (dirtyFiles.length > 0 || (target.stagedAt !== null && busy.length > 0)) {
      setIntent({
        kind: 'confirm',
        target,
        busy: target.stagedAt === null ? NO_BUSY : busy,
      })
      return
    }
    if (target.stagedAt !== null && restart.isPending) {
      observe(target)
      return
    }
    send(target, [], false)
  }

  function wait() {
    if (intent.kind !== 'confirm') return
    setIntent({ ...intent, kind: 'waiting', gateReadAt: 0 })
  }

  function updateNow() {
    if (intent.kind !== 'confirm') return
    const { target, busy: accepted } = intent
    if (target.stagedAt !== null && restart.isPending) {
      observe(target)
      return
    }
    send(
      target,
      accepted.map((session) => session.sessionId),
      false,
    )
  }

  let progressLabel: string | null = null
  if (intent.kind === 'waiting') progressLabel = 'Waiting to update…'
  if (intent.kind === 'reload') progressLabel = 'Reloading…'
  if (intent.kind === 'restarting') {
    progressLabel = 'Restarting…'
    if (connection.phase !== 'connected') progressLabel = 'Reconnecting…'
    else if (intent.confirmed) progressLabel = 'Waiting for readiness…'
  }

  return {
    progressLabel,
    intent,
    available,
    currentTarget,
    dirtyFiles,
    busy: intent.kind === 'confirm' || intent.kind === 'waiting' ? intent.busy : NO_BUSY,
    pending: intent.kind === 'restarting' && restart.isPending,
    request,
    wait,
    updateNow,
    close: () => setIntent({ kind: 'idle' }),
    liveCheck: pushed?.liveCheck ?? data?.liveCheck,
  }
}
