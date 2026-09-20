import { useEffect } from 'react'

import { useKeepAliveStore } from '@/lib/keep-alive/hooks/use-keep-alive-store'

/** Declares the ids a scope still owns; kept content outside the list is destroyed. */
export function useKeptIds(scope: string, ids: readonly string[]) {
  const store = useKeepAliveStore()
  const serialized = JSON.stringify(ids)

  useEffect(() => {
    store.prune(scope, JSON.parse(serialized) as string[])
  }, [scope, serialized, store])
}
