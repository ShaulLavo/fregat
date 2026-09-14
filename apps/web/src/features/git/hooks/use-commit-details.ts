import { useQuery } from '@tanstack/react-query'
import { commitDetailsQueryOptions } from '@/features/git/utils/history-query'

export function useCommitDetails(rootPath: string, commit: string) {
  return useQuery(commitDetailsQueryOptions(rootPath, commit))
}
