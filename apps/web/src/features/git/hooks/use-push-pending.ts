import { useIsMutating } from '@tanstack/react-query'
import { gitMutationScope } from '@/features/git/utils/mutation-keys'

export function usePushPending(rootPath: string) {
  return (
    useIsMutating({
      mutationKey: gitMutationScope(rootPath),
      predicate: (mutation) =>
        mutation.options.mutationKey?.[3] === 'push' ||
        mutation.options.mutationKey?.[3] === 'push-and-open-pull-request',
    }) > 0
  )
}
