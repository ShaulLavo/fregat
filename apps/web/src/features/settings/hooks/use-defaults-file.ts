import { useQuery } from '@tanstack/react-query'

import { defaultsFileQueryOptions } from '@/features/settings/utils/defaults-file-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function useDefaultsFile(enabled: boolean) {
  return useQuery({ ...defaultsFileQueryOptions, enabled }, resourceQueryClient)
}
