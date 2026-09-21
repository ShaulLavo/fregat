import { useQuery } from '@tanstack/react-query'
import type { ComponentProps } from 'react'

import { ModuleLoadError } from '@/components/module-load-error'
import type { TerminalPanel } from '@/features/terminal/components/panel'
import { RingLoader } from '@workspace/ui/components/ring-loader'
import { cn } from '@workspace/ui/lib/utils'
import { terminalPanelQueryOptions } from '@/features/terminal/utils/panel-query'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'

export function DeferredTerminalPanel(props: ComponentProps<typeof TerminalPanel>) {
  const query = useQuery(terminalPanelQueryOptions, primaryQueryClient())
  if (query.isPending)
    return (
      <div className={cn('relative flex items-center justify-center', props.className)}>
        <RingLoader label='Opening terminal' className='text-muted-foreground size-6' />
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
