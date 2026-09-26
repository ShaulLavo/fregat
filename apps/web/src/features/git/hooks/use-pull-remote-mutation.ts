import { pullRemote } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { useRemoteMutation } from '@/features/git/hooks/use-remote-mutation'

export function usePullRemoteMutation(rootPath: string) {
  return useRemoteMutation({ mutationKey: mutationKeys.pull(rootPath), rootPath, run: pullRemote })
}
