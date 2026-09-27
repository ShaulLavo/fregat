import { NavigationStatus } from '@/components/navigation-status'
import { useLayoutEffect, type ReactNode } from 'react'
import { AppTitlebar } from '@/components/app-titlebar'
import { AppWorkspace } from '@/components/app-workspace'
import { Wallpaper } from '@/components/wallpaper'
import { usePanelSurface } from '@/hooks/use-panel-surface'
import { cn } from '@workspace/ui/lib/utils'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { useDisplayedShell } from '@/features/workspace/hooks/use-displayed-shell'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'

export function AppShell({
  dirtyTabCloseDialog,
  restoringWorkspace,
}: {
  readonly dirtyTabCloseDialog: ReactNode
  readonly restoringWorkspace: boolean
}) {
  const surface = usePanelSurface()
  const shell = useDisplayedShell().kind
  const phone = shell === 'phone'
  const hasWorkspace = useEditorWorkspaceState((state) => state.rootFolder !== null)
  // The phone density step keys on this; the boot script sets it before the first paint.
  useLayoutEffect(() => {
    document.documentElement.dataset.shell = shell
  }, [shell])
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
      className={cn(
        'bg-background text-foreground relative isolate flex flex-col overflow-hidden',
        // The phone keyboard shrinks the dynamic viewport; the desktop window never does.
        phone ? 'h-dvh' : 'h-svh',
      )}
      ref={shellRef}
      tabIndex={-1}
    >
      {phone ? (
        <>
          {/* iOS draws its toolbar over the page: the backdrop runs under it to the large viewport,
            while the layout stops at the dynamic one so nothing interactive hides behind it. */}
          <Wallpaper className='fixed h-lvh' />
          <div
            aria-hidden='true'
            className={cn(
              surface.region,
              surface.panel,
              'pointer-events-none fixed inset-x-0 top-[100dvh] h-[calc(100lvh-100dvh)]',
            )}
          />
        </>
      ) : (
        <Wallpaper />
      )}
      {/* One blurred region for the bar and the panels, so they share a sample of the wallpaper. */}
      <div
        className={cn(surface.region, 'relative z-10 flex min-h-0 flex-1 flex-col')}
        data-surface-region=''
      >
        {/* The phone shell's screens carry their own header; with no folder open there is none. */}
        {shell === 'workbench' || !hasWorkspace ? <AppTitlebar /> : null}
        <NavigationStatus />
        <main className='min-h-0 flex-1'>
          <AppWorkspace restoringWorkspace={restoringWorkspace} />
        </main>
      </div>
      {dirtyTabCloseDialog}
    </div>
  )
}
