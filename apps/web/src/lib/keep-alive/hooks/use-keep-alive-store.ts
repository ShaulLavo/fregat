import { use } from 'react'

import { KeepAliveContext } from '@/lib/keep-alive/providers/keep-alive-context'
import { createClientInvariantError } from '@/lib/structured-errors'

export function useKeepAliveStore() {
  const store = use(KeepAliveContext)
  if (!store) throw createClientInvariantError('KeepAliveProvider is missing.')
  return store
}
