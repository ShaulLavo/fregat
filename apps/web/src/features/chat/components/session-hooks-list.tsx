import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { ListRow } from '@workspace/ui/patterns/list-row'

import type { useSessionHooks } from '@/features/chat/hooks/use-session-hooks'
import { errorMessage } from '@/lib/error-message'

export function SessionHooksList({
  hooks,
}: {
  readonly hooks: ReturnType<typeof useSessionHooks>
}) {
  if (hooks.isPending)
    return (
      <LoadingState label='Loading hooks' className='p-(--density-row-padding-x)'>
        <div aria-hidden='true' className='skeleton-sweep h-3 w-40 rounded-md' />
      </LoadingState>
    )
  if (hooks.isError)
    return (
      <EmptyState
        align='start'
        title={errorMessage(hooks.error, 'Hooks could not be read.')}
        tone='error'
      />
    )
  if (!hooks.data.supported)
    return <EmptyState align='start' title='Claude Code reads hooks from its settings files.' />
  if (!hooks.data.running) return <EmptyState align='start' title='The session is not running.' />
  if (hooks.data.hooks.length === 0 && hooks.data.errors.length === 0)
    return <EmptyState align='start' title='No hooks' />

  return (
    <>
      {hooks.data.hooks.map((hook, index) => (
        <ListRow
          className='gap-(--density-control-gap)'
          interactive={false}
          key={`${hook.sourcePath}:${hook.eventName}:${index}`}
          title={`${hook.eventName}${hook.matcher ? ` (${hook.matcher})` : ''} · ${hook.handler} · ${hook.sourcePath}`}
        >
          <span className='text-2xs shrink-0 font-mono'>{hook.eventName}</span>
          <span className='min-w-0 flex-1 truncate'>{hook.handler}</span>
          {hook.enabled ? null : <span className='text-muted-foreground text-2xs'>Off</span>}
        </ListRow>
      ))}
      {hooks.data.errors.map((error) => (
        <p className='text-warning text-2xs px-(--density-row-padding-x)' key={error}>
          {error}
        </p>
      ))}
    </>
  )
}
