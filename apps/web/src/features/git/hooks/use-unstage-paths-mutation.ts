import { unstagePaths } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { useIndexMutation } from '@/features/git/hooks/use-index-mutation'

export function useUnstagePathsMutation(paths: readonly string[], rootPath: string) {
  return useIndexMutation({
    mutationKey: mutationKeys.unstageMany(rootPath, paths),
    rootPath,
    run: (owner) => unstagePaths(paths, owner),
  })
}
