import { useQuery } from '@tanstack/react-query'
import type { ComponentProps } from 'react'

import { ModuleLoadError } from '@/components/module-load-error'
import type { LogsPanel } from '@/features/logs/components/panel'
import { logsPanelQueryOptions } from '@/features/logs/utils/panel-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { Spinner } from '@workspace/ui/components/spinner'

export function DeferredLogsPanel(props: ComponentProps<typeof LogsPanel>) {
  const query = useQuery(logsPanelQueryOptions, resourceQueryClient)
  if (query.isPending)
    return (
      <div className='flex h-full items-center justify-center'>
        <Spinner size='md' label='Opening logs' />
      </div>
    )
  if (query.isError)
    return <ModuleLoadError className='h-full' label='logs' onRetry={() => void query.refetch()} />

  const { LogsPanel: View } = query.data
  return <View {...props} />
}
