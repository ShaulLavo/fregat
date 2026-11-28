import { useQuery } from '@tanstack/react-query'
import { commitDetailsQueryOptions } from '@/lib/git-commit-details-query'

export function useCommitDetails(rootPath: string, commit: string) {
  return useQuery({
    ...commitDetailsQueryOptions(rootPath, commit),
    placeholderData: (previous, query) => (query?.queryKey[2] === rootPath ? previous : undefined),
  })
}
