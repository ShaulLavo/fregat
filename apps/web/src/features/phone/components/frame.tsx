import type { ReactNode } from 'react'
import { cn } from '@workspace/ui/lib/utils'

import { usePanelSurface } from '@/hooks/use-panel-surface'
import { useKeyboardInset } from '@/features/phone/hooks/use-keyboard-inset'

/** The phone's frame: the panel surface inside the safe areas, above the on-screen keyboard. */
export function Frame({ children }: { readonly children: ReactNode }) {
  const surface = usePanelSurface()
  useKeyboardInset()

  return (
    <div
      className={cn(
        surface.panel,
        'flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[max(env(safe-area-inset-bottom),var(--keyboard-inset))] pl-[env(safe-area-inset-left)]',
      )}
      data-phone-shell=''
    >
      {children}
    </div>
  )
}
