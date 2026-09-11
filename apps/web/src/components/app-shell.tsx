import { NavigationStatus } from '@/components/navigation-status'
import type { ReactNode } from 'react'
import { AppTitlebar } from '@/components/app-titlebar'
import { AppWorkspace } from '@/components/app-workspace'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

export function AppShell({
  dirtyTabCloseDialog,
  restoringWorkspace,
}: {
  readonly dirtyTabCloseDialog: ReactNode
  readonly restoringWorkspace: boolean
}) {
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
      className='bg-background text-foreground flex h-svh flex-col overflow-hidden'
      ref={shellRef}
      tabIndex={-1}
    >
      <AppTitlebar />
      <NavigationStatus />
      <main className='min-h-0 flex-1'>
        <AppWorkspace restoringWorkspace={restoringWorkspace} />
      </main>
      {dirtyTabCloseDialog}
    </div>
  )
}
