import { startPageSubscription } from '@/lib/state/page-subscription'
import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  superviseSettingsStream as runSettingsStream,
  type SettingsStreamDependencies,
} from '@workspace/client-core/settings/stream'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { environmentLogContext } from '@/lib/environments/state/log-context'
import { log } from '@/lib/client-logging'
import { settingsSnapshotAdmission } from '@/features/settings/state/snapshot-admission'

export function useSettingsStream() {
  const queryClient = useSettingsOwner()
  useEffect(() => {
    return startPageSubscription(() => {
      const controller = new AbortController()
      void superviseSettingsStream(queryClient, controller.signal)
      return () => controller.abort()
    })
  }, [queryClient])
}

export function superviseSettingsStream(
  queryClient: QueryClient,
  signal: AbortSignal,
  overrides: Partial<SettingsStreamDependencies> = {},
) {
  const context = environmentLogContext(originForQueryClient(queryClient))
  return runSettingsStream(
    queryClient,
    signal,
    {
      client: clientForQueryClient(queryClient),
      admission: settingsSnapshotAdmission,
      record: (event) => {
        const ownedEvent = { ...event, ...context }
        if (event.outcome === 'aborted') log.debug(ownedEvent)
        else log.warn(ownedEvent)
      },
    },
    overrides,
  )
}
