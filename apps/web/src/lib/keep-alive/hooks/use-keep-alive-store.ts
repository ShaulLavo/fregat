import { use } from 'react'

import { KeepAliveContext } from '@/lib/keep-alive/providers/keep-alive-context'
import { requireContext } from '@/lib/require-context'

export function useKeepAliveStore() {
  const store = use(KeepAliveContext)
  requireContext(store, 'KeepAliveProvider is missing.')
  return store
}
