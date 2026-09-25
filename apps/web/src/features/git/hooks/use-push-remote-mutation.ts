import { pushRemote } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { useRemoteMutation } from '@/features/git/hooks/use-remote-mutation'

export function usePushRemoteMutation(rootPath: string) {
  return useRemoteMutation({ mutationKey: mutationKeys.push(rootPath), rootPath, run: pushRemote })
}
