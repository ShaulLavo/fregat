import { discardPaths } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { useIndexMutation } from '@/features/git/hooks/use-index-mutation'

export function useDiscardPathsMutation(paths: readonly string[], rootPath: string) {
  return useIndexMutation({
    discards: paths,
    mutationKey: mutationKeys.discard(rootPath, paths),
    rootPath,
    run: (owner) => discardPaths(paths, owner),
  })
}
