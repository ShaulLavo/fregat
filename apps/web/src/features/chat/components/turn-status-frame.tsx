import type { ReactNode } from 'react'

/**
 * The line under a prompt that reads Working, then the finished status. One fixed height fits
 * the fold's button, so the swap at the end of a turn leaves the answer below where it was.
 */
export function TurnStatusFrame({ children }: { children: ReactNode }) {
  return (
    <div className='text-muted-foreground flex h-(--turn-status-height) items-center pt-1 pb-2 text-xs tabular-nums'>
      {children}
    </div>
  )
}
