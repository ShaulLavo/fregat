import { syncRemote } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { useRemoteMutation } from '@/features/git/hooks/use-remote-mutation'

export function useSyncChangesMutation(rootPath: string) {
  return useRemoteMutation({ mutationKey: mutationKeys.sync(rootPath), rootPath, run: syncRemote })
}
