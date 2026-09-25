import { useSyncExternalStore } from 'react'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { LoadingState } from '@workspace/ui/components/loading-state'
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
  return (
    <LoadingState label='Opening destination'>
      <div className='skeleton-sweep h-1 w-32' />
    </LoadingState>
  )
}
