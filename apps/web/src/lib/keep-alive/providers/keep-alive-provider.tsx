import { useState, type ReactNode } from 'react'

import { KeepAliveOutlet } from '@/lib/keep-alive/components/keep-alive-outlet'
import { KeepAliveContext } from '@/lib/keep-alive/providers/keep-alive-context'
import { createKeepAliveStore } from '@/lib/keep-alive/state/store'

/**
 * Mount above every layout whose unmount the kept content must survive. Kept
 * content renders here, so it sees this provider's context, not its slot's.
 */
export function KeepAliveProvider({ children }: { readonly children: ReactNode }) {
  const [store] = useState(createKeepAliveStore)

  return (
    <KeepAliveContext value={store}>
      {children}
      <KeepAliveOutlet store={store} />
    </KeepAliveContext>
  )
}
