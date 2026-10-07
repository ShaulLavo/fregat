import { useQuery } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import { Spinner } from '@workspace/ui/components/spinner'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { ModuleLoadError } from '@/components/module-load-error'
import type { ChatSidePanel } from '@/features/chat/components/chat-side-panel'
import { sidePanelModuleQueryOptions } from '@/features/chat/utils/side-panel-module'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function DeferredSidePanel(props: ComponentProps<typeof ChatSidePanel>) {
  const query = useQuery(sidePanelModuleQueryOptions(), resourceQueryClient)
  if (query.isPending)
    return (
      <div className='flex h-full items-center justify-center'>
        <Spinner size='md' label='Opening chat panel' />
      </div>
    )
  if (query.isError)
    return (
      <ModuleLoadError className='h-full' label='chat panel' onRetry={() => void query.refetch()} />
    )

  const { ChatSidePanel: View } = query.data
  return (
    <RenderErrorBoundary label='chat panel' resetKeys={[props.rootPath]}>
      <View {...props} />
    </RenderErrorBoundary>
  )
}
