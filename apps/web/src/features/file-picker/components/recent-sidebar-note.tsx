import type { ReactNode } from 'react'

export function RecentSidebarNote({ children }: { children: ReactNode }) {
  return (
    <div className='text-muted-foreground px-(--density-row-padding-x) py-1 text-xs'>
      {children}
    </div>
  )
}
