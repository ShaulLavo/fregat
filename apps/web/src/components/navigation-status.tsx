import { useSyncExternalStore } from 'react'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { useNavigation } from '@/hooks/use-navigation'
import { FixWithAgentButton } from '@/components/fix-with-agent-button'
import { WorkspaceSwitchPending } from '@/components/workspace-switch-pending'
import { Button } from '@workspace/ui/components/button'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'

export function NavigationStatus() {
  const navigation = useNavigation()
  const openPicker = useEditorWorkspaceState((state) => state.openPicker)
  const status = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  if (status.status === 'applied') return null
  if (status.status === 'unavailable')
    return (
      <Alert variant='destructive'>
        <AlertDescription>
          <p>{status.reason}</p>
          <div className='flex items-center gap-(--density-gap-tight)'>
            <Button onClick={openPicker} size='xs' variant='secondary'>
              Choose folder
            </Button>
            <FixWithAgentButton error={{ message: status.reason, title: 'Navigation' }} />
          </div>
        </AlertDescription>
      </Alert>
    )
  if (status.target)
    return <WorkspaceSwitchPending key={status.target.path} target={status.target} />
  return (
    <LoadingState label='Opening destination'>
      <div className='skeleton-sweep h-1 w-32' />
    </LoadingState>
  )
}
