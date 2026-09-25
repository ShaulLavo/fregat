import { discardPaths, unstagePaths } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { useIndexMutation } from '@/features/git/hooks/use-index-mutation'

export function useDiscardStagedPathsMutation(paths: readonly string[], rootPath: string) {
  return useIndexMutation({
    discards: paths,
    mutationKey: mutationKeys.discardStaged(rootPath, paths),
    rootPath,
    run: async (owner) => {
      await unstagePaths(paths, owner)
      return discardPaths(paths, owner)
    },
  })
}
