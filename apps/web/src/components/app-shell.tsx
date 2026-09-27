import { NavigationStatus } from '@/components/navigation-status'
import { useLayoutEffect, type ReactNode } from 'react'
import { AppTitlebar } from '@/components/app-titlebar'
import { AppWorkspace } from '@/components/app-workspace'
import { Wallpaper } from '@/components/wallpaper'
import { usePanelSurface } from '@/hooks/use-panel-surface'
import { cn } from '@workspace/ui/lib/utils'
import { PresentationContext } from '@workspace/ui/patterns/sheet'
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
    // The phone presents pickers, popovers and menus as bottom sheets.
    <PresentationContext value={shell === 'phone' ? 'sheet' : 'anchored'}>
      <div
        className={cn(
          'bg-background text-foreground relative isolate flex flex-col overflow-hidden',
          // The phone keyboard shrinks the dynamic viewport; the desktop window never does.
          shell === 'phone' ? 'h-dvh' : 'h-svh',
        )}
        ref={shellRef}
        tabIndex={-1}
      >
        <Wallpaper />
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
    </PresentationContext>
  )
}
