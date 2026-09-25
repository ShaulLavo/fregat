import { use } from 'react'

import { KeepAliveContext } from '@/lib/keep-alive/providers/keep-alive-context'
import { clientErrors } from '@/lib/structured-errors'

export function useKeepAliveStore() {
  const store = use(KeepAliveContext)
  if (!store) throw clientErrors.CONTEXT_MISSING({ message: 'KeepAliveProvider is missing.' })
  return store
}
