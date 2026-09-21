import { useQuery } from '@tanstack/react-query'
import type { ComponentProps } from 'react'

import { ModuleLoadError } from '@/components/module-load-error'
import type { SettingsPage } from '@/features/settings/components/page'
import { PageLoading } from '@/features/settings/components/page-loading'
import { settingsPageQueryOptions } from '@/features/settings/utils/page-query'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'

export function DeferredSettingsPage(props: ComponentProps<typeof SettingsPage>) {
  const query = useQuery(settingsPageQueryOptions, primaryQueryClient())
  if (query.isPending) return <PageLoading showJson={false} />
  if (query.isError)
    return <ModuleLoadError label='settings' onRetry={() => void query.refetch()} />

  const { SettingsPage: View } = query.data
  return <View {...props} />
}
