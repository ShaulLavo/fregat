import { use } from 'react'

import { PaneHostContext, type PaneHost } from '@/providers/pane-host-context'

/** The host this pane renders in, or null outside every host (a settings page, a dialog). */
export function usePaneHost(): PaneHost | null {
  return use(PaneHostContext)
}
