import { pickerMutationKeys } from '@/features/file-picker/utils/mutation-keys'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { PickedFsEntry } from '@/lib/file-system-types'
import { runMutation } from '@/lib/mutations/run'
import { recordRecentMutationOptions } from '@/lib/record-recent-mutation'

export function useRecordRecentMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (entry: PickedFsEntry) =>
      runMutation(queryClient, recordRecentMutationOptions(queryClient, entry.path), undefined),
    mutationKey: pickerMutationKeys.recordRecent,
  })
}
