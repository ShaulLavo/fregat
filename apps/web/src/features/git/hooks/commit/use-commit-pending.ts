import { useIsMutating } from '@tanstack/react-query'

import { mutationKeys } from '@/features/git/utils/mutation-keys'

export function useCommitPending(rootPath: string) {
  return useIsMutating({ mutationKey: mutationKeys.commit(rootPath) }) > 0
}
