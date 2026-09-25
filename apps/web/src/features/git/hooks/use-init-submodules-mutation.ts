import { admitGitWrite } from '@/features/git/utils/admit-mutation'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useMutation } from '@tanstack/react-query'

import { initializeSubmodules } from '@/features/git/utils/api'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { settleDiskWriteGitStatus } from '@/features/git/utils/settle-status'

export function useInitSubmodulesMutation(rootPath: string) {
  return useMutation({
    mutationFn: async (_variables: void, { client }) => {
      admitGitWrite(client)
      return initializeSubmodules(rootPath, clientForQueryClient(client))
    },
    mutationKey: mutationKeys.initSubmodules(rootPath),
    onError: notifyMutationError,
    onSuccess: (status, _variables, _onMutateResult, { client }) =>
      settleDiskWriteGitStatus(client, rootPath, status),
  })
}
