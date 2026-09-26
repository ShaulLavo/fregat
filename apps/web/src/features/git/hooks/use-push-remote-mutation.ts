import { usePushPending } from '@/features/git/hooks/use-push-pending'
import { pushRemote } from '@/features/git/utils/api'
import { gitRemoteMutationScope, mutationKeys } from '@/features/git/utils/mutation-keys'
import { useRemoteMutation } from '@/features/git/hooks/use-remote-mutation'

export function usePushRemoteMutation(rootPath: string) {
  const isPending = usePushPending(rootPath)
  const mutation = useRemoteMutation({
    mutationKey: mutationKeys.push(rootPath),
    refetch: 'checkout',
    rootPath,
    run: pushRemote,
    scope: gitRemoteMutationScope(rootPath),
  })
  return { ...mutation, isPending }
}
