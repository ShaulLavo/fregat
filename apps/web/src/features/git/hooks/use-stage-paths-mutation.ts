import { stagePaths } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { useIndexMutation } from '@/features/git/hooks/use-index-mutation'

export function useStagePathsMutation(paths: readonly string[], rootPath: string) {
  return useIndexMutation({
    mutationKey: mutationKeys.stageMany(rootPath, paths),
    rootPath,
    run: (owner) => stagePaths(paths, owner),
  })
}
