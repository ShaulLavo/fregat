import { queryOptions } from '@tanstack/react-query'
import { pullRequestDiscussionKeys } from '@/features/git/utils/query-keys'

export const discussionDialogQueryOptions = queryOptions({
  queryKey: pullRequestDiscussionKeys.dialogModule,
  queryFn: () => import('@/features/git/components/discussion-dialog'),
  staleTime: 'static',
  structuralSharing: false,
  gcTime: Infinity,
  networkMode: 'always',
})
