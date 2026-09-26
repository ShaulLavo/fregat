import { Spinner } from '@workspace/ui/components/spinner'
import { useDelayedVisible } from '@workspace/ui/hooks/use-delayed-visible'
import type { NavigationTarget } from '@/state/navigation-coordinator'

// A switch that lands this fast needs no notice; a dim for a frame reads as flicker.
const SWITCH_NOTICE_DELAY_MS = 150

/**
 * While a folder opens, the workspace being left is dimmed and takes no clicks: a click there
 * would only be dropped. The titlebar stays live for opening something else or going back.
 */
export function WorkspaceSwitchPending({ target }: { readonly target: NavigationTarget }) {
  const visible = useDelayedVisible(SWITCH_NOTICE_DELAY_MS)
  if (!visible) return null

  return (
    <>
      <div
        aria-hidden='true'
        className='bg-background/40 absolute inset-x-0 top-(--bar-height) bottom-0 z-10'
        data-navigation-shield=''
      />
      <div
        className='bg-popover-solid text-popover-foreground ring-foreground/10 absolute top-(--bar-height) left-1/2 z-20 mt-2 flex h-7 max-w-80 -translate-x-1/2 items-center gap-2 rounded-full px-3 text-xs shadow-md ring-1'
        data-navigation-target=''
        title={`Opening /${target.path}`}
      >
        <Spinner size='xs' label={`Opening ${target.name}`} />
        <span className='truncate'>Opening {target.name}</span>
      </div>
    </>
  )
}
