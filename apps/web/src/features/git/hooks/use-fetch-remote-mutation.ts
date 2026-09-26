import { fetchRemote } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { useRemoteMutation } from '@/features/git/hooks/use-remote-mutation'

export function useFetchRemoteMutation(rootPath: string) {
  return useRemoteMutation({
    mutationKey: mutationKeys.fetch(rootPath),
    rootPath,
    run: fetchRemote,
  })
}
