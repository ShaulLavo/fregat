import { useId } from 'react'
import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query'
import { readPagedWindow } from '@/features/workbench/utils/paged-resource'
import { pagedResourceOptions } from '@/features/workbench/utils/paged-resource'
import { pagedFileQueryKeys } from '@/features/workbench/utils/query-keys'

export function usePagedFile(path: string, line: number, generation: number) {
  const instance = useId()
  const resource = useQuery(pagedResourceOptions(instance, path, generation))
  const owned = resource.data
  const index = useQuery({
    queryKey: pagedFileQueryKeys.index(owned?.source.id ?? instance),
    queryFn: owned
      ? async () => {
          await owned.document.initialize()
          return owned.document.stats
        }
      : skipToken,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    structuralSharing: false,
  })
  const page = useQuery({
    queryKey: pagedFileQueryKeys.page(owned?.source.id ?? instance, line),
    queryFn: owned ? ({ signal }) => readPagedWindow(owned, line, signal) : skipToken,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    structuralSharing: false,
    placeholderData: keepPreviousData,
  })
  return { resource, index, page }
}
