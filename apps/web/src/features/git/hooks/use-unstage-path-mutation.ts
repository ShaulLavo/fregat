import { unstagePath } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { useIndexMutation } from '@/features/git/hooks/use-index-mutation'

export function useUnstagePathMutation(path: string, rootPath: string) {
  return useIndexMutation({
    mutationKey: mutationKeys.unstage(rootPath, path),
    rootPath,
    run: (owner) => unstagePath(path, owner),
  })
}
