import { useQuery } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import { Spinner } from '@workspace/ui/components/spinner'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { ModuleLoadError } from '@/components/module-load-error'
import type { ChatModeSurfaceView } from '@/features/chat-mode/components/surface-view'
import { surfaceModuleQueryOptions } from '@/features/chat-mode/utils/surface-module'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function DeferredSurfaceView(props: ComponentProps<typeof ChatModeSurfaceView>) {
  const query = useQuery(surfaceModuleQueryOptions(), resourceQueryClient)
  if (query.isPending)
    return (
      <div className='flex h-full items-center justify-center'>
        <Spinner size='md' label='Opening chat workspace' />
      </div>
    )
  if (query.isError)
    return (
      <ModuleLoadError
        className='h-full'
        label='chat workspace'
        onRetry={() => void query.refetch()}
      />
    )

  const { ChatModeSurfaceView: View } = query.data
  return (
    <RenderErrorBoundary label='chat workspace' resetKeys={[props.rootPath]}>
      <View {...props} />
    </RenderErrorBoundary>
  )
}
