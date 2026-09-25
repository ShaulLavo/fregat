import type { QueryClient } from '@tanstack/react-query'
import { gitKeys } from '@/lib/query-keys'

export function invalidateCheckout(queryClient: QueryClient, rootPath: string) {
  return queryClient.invalidateQueries({
    queryKey: gitKeys.all,
    predicate: ({ queryKey }) => {
      const path = queryKey[2]
      if (path === rootPath) return true
      if (typeof path !== 'string' || !['diffs', 'file'].includes(String(queryKey[1]))) return false
      return rootPath === '' || path.startsWith(`${rootPath}/`)
    },
  })
}
