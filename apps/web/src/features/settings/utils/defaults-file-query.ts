import { queryOptions } from '@tanstack/react-query'

import { settingsQueryKeys } from '@/features/settings/utils/query-keys'

export const defaultsFileQueryOptions = queryOptions({
  queryKey: settingsQueryKeys.defaultsFile,
  queryFn: async () => {
    const { defaultsLayerFile } = await import('@/features/settings/utils/defaults-file')
    return defaultsLayerFile()
  },
  staleTime: 'static',
  gcTime: Infinity,
  networkMode: 'always',
})
