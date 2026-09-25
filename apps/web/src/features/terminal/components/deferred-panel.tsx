import { useQuery } from '@tanstack/react-query'
import type { ComponentProps } from 'react'

import { ModuleLoadError } from '@/components/module-load-error'
import type { TerminalPanel } from '@/features/terminal/components/panel'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'
import { terminalPanelQueryOptions } from '@/features/terminal/utils/panel-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function DeferredTerminalPanel(props: ComponentProps<typeof TerminalPanel>) {
  const query = useQuery(terminalPanelQueryOptions, resourceQueryClient)
  if (query.isPending)
    return (
      <div className={cn('relative flex items-center justify-center', props.className)}>
        <Spinner size='md' label='Opening terminal' />
      </div>
    )
  if (query.isError)
    return (
      <ModuleLoadError
        className={props.className}
        label='terminal'
        onRetry={() => void query.refetch()}
      />
    )

  const { TerminalPanel: View } = query.data
  return <View {...props} />
}
