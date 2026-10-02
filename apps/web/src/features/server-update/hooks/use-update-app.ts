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
  const restarting =
    intent.kind === 'restarting' &&
    (intent.confirmed ||
      connection.phase !== 'connected' ||
      connection.serverInstanceId !== intent.instance)
  const pageTarget: UpdateTarget | null =
    loadedRelease && data?.release && loadedRelease !== data.release
      ? { release: data.release, stagedAt: null }
      : null
  const available = pending ?? pageTarget
  const currentTarget = intent.kind === 'idle' ? available : intent.target

  function send(target: UpdateTarget, interrupt: SessionId[], waiting: boolean) {
    if (target.stagedAt === null) {
      setIntent({ kind: 'reload', target })
      return
    }
    const instance = connection.serverInstanceId
    const fromRelease = data?.server.release ?? null
    restart.mutate(
      { target, interrupt },
      {
        onSuccess: (answer) => {
          const current = updateIntentStore.getState().intent
          if (current.kind === 'idle' || !sameUpdateTarget(current.target, target)) return
          if (answer.restarting)
            setIntent({ kind: 'restarting', target, confirmed: true, instance, fromRelease })
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
          if (current.kind === 'idle' || !sameUpdateTarget(current.target, target)) return
          if (isRestartDisconnect(error))
            setIntent({ kind: 'restarting', target, confirmed: false, instance, fromRelease })
          else {
            setIntent({ kind: 'failed', target })
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
    if (newerUpdateTarget(pending, target) || newerUpdateTarget(pushed?.pending, target)) {
      setIntent({ kind: 'idle' })
      return
    }
    if (target.stagedAt === null && data.release !== target.release) {
      setIntent({ kind: 'idle' })
      return
    }
    const healthy = releaseReadyForReload(data, target)
    if (intent.kind === 'restarting') {
      if (
        data.server.release &&
        data.server.release !== intent.fromRelease &&
        data.server.release !== target.release
      ) {
        setIntent({ kind: 'idle' })
        return
      }
      if (
        data.liveCheck?.release === target.release &&
        data.liveCheck.status === 'failed' &&
        target.stagedAt !== null &&
        Date.parse(data.liveCheck.at) >= Date.parse(target.stagedAt)
      ) {
        setIntent({ kind: 'failed', target })
        return
      }
      if (healthy) setIntent({ kind: 'reload', target })
      return
    }
    if (intent.kind === 'reload') {
      if (healthy && dirtyFiles.length === 0 && !navigation.isPending) navigation.mutate(target)
      return
    }
    if (intent.kind !== 'waiting' || restart.isPending) return
    if (target.stagedAt === null) {
      if (dirtyFiles.length === 0) setIntent({ kind: 'reload', target })
      return
    }
    if (!sameUpdateTarget(pending, target)) {
      setIntent({ kind: 'idle' })
      return
    }
    if (dirtyFiles.length === 0 && busy.length === 0 && query.dataUpdatedAt > intent.gateReadAt)
      send(target, [], true)
    else if (!sameBusySessions(intent.busy, busy)) setIntent({ ...intent, busy })
  })

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
    if (!data || intent.kind === 'reload' || !available || restart.isPending || restarting) return
    if (dirtyFiles.length > 0 || (available.stagedAt !== null && busy.length > 0)) {
      setIntent({
        kind: 'confirm',
        target: available,
        busy: available.stagedAt === null ? NO_BUSY : busy,
      })
      return
    }
    if (available.stagedAt === null) setIntent({ kind: 'reload', target: available })
    else
      setIntent({
        kind: 'restarting',
        target: available,
        confirmed: false,
        instance: connection.serverInstanceId,
        fromRelease: data?.server.release ?? null,
      })
    if (available.stagedAt !== null) send(available, [], false)
  }

  function wait() {
    if (intent.kind !== 'confirm') return
    setIntent({ ...intent, kind: 'waiting', gateReadAt: 0 })
  }

  function updateNow() {
    if (intent.kind !== 'confirm') return
    const { target, busy: accepted } = intent
    if (target.stagedAt === null) setIntent({ kind: 'reload', target })
    else
      setIntent({
        kind: 'restarting',
        target,
        confirmed: false,
        instance: connection.serverInstanceId,
        fromRelease: data?.server.release ?? null,
      })
    send(
      target,
      accepted.map((session) => session.sessionId),
      false,
    )
  }

  return {
    intent,
    restarting,
    available,
    currentTarget,
    dirtyFiles,
    busy: intent.kind === 'confirm' || intent.kind === 'waiting' ? intent.busy : NO_BUSY,
    pending: restart.isPending,
    request,
    wait,
    updateNow,
    close: () => setIntent({ kind: 'idle' }),
    liveCheck: pushed?.liveCheck ?? data?.liveCheck,
  }
}
