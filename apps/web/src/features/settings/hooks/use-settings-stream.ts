import { startPageSubscription } from '@/lib/state/page-subscription'
import { useEffect } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  superviseSettingsStream as runSettingsStream,
  type SettingsStreamDependencies,
  type SettingsStreamStop,
} from '@workspace/client-core/settings/stream'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { environmentLogContext } from '@/lib/environments/state/log-context'
import { log } from '@/lib/client-logging'
import { settingsSnapshotAdmission } from '@/features/settings/state/snapshot-admission'
import {
  dismissSettingsStreamStopped,
  notifySettingsStreamStopped,
} from '@/features/settings/utils/notify-stream-stopped'

export function useSettingsStream() {
  const queryClient = useSettingsOwner()
  useEffect(() => {
    return startPageSubscription(() => {
      const controller = new AbortController()
      let stopped = false
      // The toast's action closes it, so only a departure with the toast up dismisses it.
      const run = () => {
        stopped = false
        void superviseSettingsStream(queryClient, controller.signal, {}, (stop) => {
          stopped = true
          notifySettingsStreamStopped(stop, run)
        })
      }
      run()
      return () => {
        controller.abort()
        if (stopped) dismissSettingsStreamStopped()
      }
    })
  }, [queryClient])
}

export function superviseSettingsStream(
  queryClient: QueryClient,
  signal: AbortSignal,
  overrides: Partial<SettingsStreamDependencies> = {},
  stopped?: (stop: SettingsStreamStop) => void,
) {
  const context = environmentLogContext(originForQueryClient(queryClient))
  return runSettingsStream(
    queryClient,
    signal,
    {
      client: clientForQueryClient(queryClient),
      admission: settingsSnapshotAdmission,
      record: ({ level, ...event }) => log[level]({ ...event, ...context }),
      stopped,
    },
    overrides,
  )
}
