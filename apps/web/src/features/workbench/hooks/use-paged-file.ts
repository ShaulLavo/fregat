import { useId, useState } from 'react'
import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query'
import {
  pagedResourceOptions,
  readPagedWindow,
  type PagedNavigation,
} from '@/features/workbench/utils/paged-resource'
import { pagedFileQueryKeys } from '@/features/workbench/utils/query-keys'

type PageRequest = {
  readonly sourceId: string
  readonly sequence: number
  readonly navigation: PagedNavigation
}

export function usePagedFile(path: string, generation: number) {
  const instance = useId()
  const [request, setRequest] = useState<PageRequest>()
  const resource = useQuery(pagedResourceOptions(instance, path, generation))
  const owned = resource.data
  const current = request?.sourceId === owned?.source.id ? request : undefined
  const page = useQuery({
    queryKey: pagedFileQueryKeys.page(owned?.source.id ?? instance, current?.sequence ?? 0),
    queryFn: owned
      ? ({ signal }) => readPagedWindow(owned, current?.navigation, signal)
      : skipToken,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    structuralSharing: false,
    placeholderData: keepPreviousData,
  })

  function navigate(navigation: PagedNavigation) {
    if (!owned) return
    const sourceId = owned.source.id
    setRequest((previous) => ({
      sourceId,
      sequence: (previous?.sequence ?? 0) + 1,
      navigation,
    }))
  }

  return { resource, page, navigate }
}
