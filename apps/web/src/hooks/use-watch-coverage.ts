import { useQueryClient } from '@tanstack/react-query'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { useWatchCoverageStore, watchCoverageKey } from '@/lib/state/watch-coverage'

export function useWatchCoverage(rootPath: string) {
  const key = watchCoverageKey(originForQueryClient(useQueryClient()), rootPath)
  return useWatchCoverageStore((store) => store.byRoot[key])
}
