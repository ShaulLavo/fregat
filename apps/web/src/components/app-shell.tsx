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
    const root = document.documentElement
    root.dataset.shell = shell
    if (shell !== 'phone') return

    // Safari's large viewport excludes its persistent toolbar; the wallpaper covers that too.
    const resizeBackdrop = () => {
      root.style.setProperty('--phone-backdrop-height', `${window.outerHeight}px`)
    }
    resizeBackdrop()
    window.addEventListener('resize', resizeBackdrop)
    return () => {
      window.removeEventListener('resize', resizeBackdrop)
      root.style.removeProperty('--phone-backdrop-height')
    }
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
        'bg-background in-data-[backdrop=transparent]:bg-transparent text-foreground relative isolate flex flex-col outline-none',
        // The phone keyboard shrinks the dynamic viewport; the desktop window never does.
        phone ? 'h-dvh' : 'h-svh overflow-hidden',
      )}
      aria-busy={restoringWorkspace}
      ref={shellRef}
      tabIndex={-1}
    >
      {phone ? (
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-x-0 top-0 h-[max(100lvh,var(--phone-backdrop-height,100lvh))]'
        >
          {/* Safari clips fixed layers above its toolbar, including oversized wallpapers. */}
          <Wallpaper />
          <div className={cn(surface.region, 'absolute inset-0')} />
        </div>
      ) : (
        <Wallpaper />
      )}
      {/* One blurred region for the bar and the panels, so they share a sample of the wallpaper. */}
      <div
        className={cn(!phone && surface.region, 'relative z-10 flex min-h-0 flex-1 flex-col')}
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
