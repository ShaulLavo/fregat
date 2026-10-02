import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { serverUpdateQueryKeys } from '@/features/server-update/utils/query-keys'
import { useSettingValue } from '@/hooks/use-setting-value'
import { log } from '@/lib/client-logging'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { clientForQueryClient, primaryQueryClient } from '@/lib/environments/state/query-clients'

export function ClientUpdate() {
  const [loadedRelease] = useState(
    () => document.querySelector<HTMLMetaElement>('meta[name="platform-release"]')?.content ?? null,
  )
  const interval = useSettingValue('developer.clientUpdateCheckSeconds')
  const queryClient = primaryQueryClient()
  const { data } = useQuery(
    {
      queryKey: serverUpdateQueryKeys.release(),
      queryFn: async () =>
        unwrapEdenResponse(await clientForQueryClient(queryClient).release.get(), {
          requireData: true,
        }),
      enabled: loadedRelease !== null,
      staleTime: 0,
      refetchInterval: interval * 1000,
      refetchOnWindowFocus: 'always',
    },
    queryClient,
  )
  const available = data?.release
  const serverRelease = data?.server.release
  const refresh = loadedRelease && available && loadedRelease !== available

  useEffect(() => {
    if (!loadedRelease || !available) return
    log.info({
      area: 'server-update',
      action: 'client.release',
      loadedRelease,
      servedRelease: available,
      serverRelease,
      outcome: loadedRelease === available ? 'current' : 'refresh-available',
    })
  }, [loadedRelease, available, serverRelease])

  useEffect(() => {
    if (!refresh) return
    const id = toast('Update available', {
      id: 'client-update',
      duration: Infinity,
      action: { label: 'Reload app', onClick: () => window.location.reload() },
    })
    return () => {
      toast.dismiss(id)
    }
  }, [refresh])

  return null
}
