import { stagePath } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { useIndexMutation } from '@/features/git/hooks/use-index-mutation'

export function useStagePathMutation(path: string, rootPath: string) {
  return useIndexMutation({
    mutationKey: mutationKeys.stage(rootPath, path),
    rootPath,
    run: (owner) => stagePath(path, owner),
  })
}
