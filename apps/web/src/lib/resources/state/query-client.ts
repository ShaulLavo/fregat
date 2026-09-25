import { QueryClient } from '@tanstack/query-core'

export function createResourceQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: 1 } } })
}

export const resourceQueryClient = createResourceQueryClient()
if (import.meta.env.DEV)
  Object.assign(globalThis, { __fregatResourceQueryClient: resourceQueryClient })
