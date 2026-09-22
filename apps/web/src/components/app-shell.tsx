import { NavigationStatus } from '@/components/navigation-status'
import type { ReactNode } from 'react'
import { AppTitlebar } from '@/components/app-titlebar'
import { AppWorkspace } from '@/components/app-workspace'
import { Wallpaper } from '@/components/wallpaper'
import { usePanelSurface } from '@/hooks/use-panel-surface'
import { cn } from '@workspace/ui/lib/utils'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

export function AppShell({
  dirtyTabCloseDialog,
  restoringWorkspace,
}: {
  readonly dirtyTabCloseDialog: ReactNode
  readonly restoringWorkspace: boolean
}) {
  const surface = usePanelSurface()
  const { ref: shellRef } = useFocusTarget<HTMLDivElement>({
    area: 'global',
    id: { kind: 'app-shell' },
    onIntent: (intent, element) => {
      if (intent !== 'focus') return false

      element.focus()
      return true
    },
  })

  return (
    <div
      className='bg-background text-foreground relative isolate flex h-svh flex-col overflow-hidden'
      ref={shellRef}
      tabIndex={-1}
    >
      <Wallpaper />
      {/* One blurred region for the bar and the panels, so they share a sample of the wallpaper. */}
      <div
        className={cn(surface.region, 'relative z-10 flex min-h-0 flex-1 flex-col')}
        data-surface-region=''
      >
        <AppTitlebar />
        <NavigationStatus />
        <main className='min-h-0 flex-1'>
          <AppWorkspace restoringWorkspace={restoringWorkspace} />
        </main>
      </div>
      {dirtyTabCloseDialog}
    </div>
  )
}
