import { useSyncExternalStore } from 'react'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { Spinner } from '@workspace/ui/components/spinner'
import { useNavigation } from '@/hooks/use-navigation'
import { FixWithAgentButton } from '@/components/fix-with-agent-button'

export function NavigationStatus() {
  const navigation = useNavigation()
  const status = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  if (status.status === 'applied') return null
  if (status.status === 'unavailable')
    return (
      <Alert variant='destructive'>
        <AlertDescription>
          <p>{status.reason}</p>
          <FixWithAgentButton error={{ message: status.reason, title: 'Navigation' }} />
        </AlertDescription>
      </Alert>
    )
  if (status.target)
    return (
      <div
        className='bg-popover-solid text-popover-foreground ring-foreground/10 absolute top-(--bar-height) left-1/2 z-20 mt-2 flex h-7 max-w-80 -translate-x-1/2 items-center gap-2 rounded-full px-3 text-xs shadow-md ring-1'
        data-navigation-target=''
        title={`Opening /${status.target.path}`}
      >
        <Spinner size='xs' label={`Opening ${status.target.name}`} />
        <span className='truncate'>Opening {status.target.name}</span>
      </div>
    )
  return (
    <LoadingState label='Opening destination'>
      <div className='skeleton-sweep h-1 w-32' />
    </LoadingState>
  )
}
