import { useSyncExternalStore } from 'react'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { useNavigation } from '@/hooks/use-navigation'

export function NavigationStatus() {
  const navigation = useNavigation()
  const status = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  if (status.status === 'applied') return null
  if (status.status === 'unavailable')
    return (
      <div role='alert' className='bg-background text-destructive p-3'>
        {status.reason}
      </div>
    )
  return (
    <LoadingState label='Opening destination'>
      <div className='skeleton-sweep h-1 w-32' />
    </LoadingState>
  )
}
