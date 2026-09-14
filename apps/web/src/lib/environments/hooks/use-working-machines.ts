import { useMutationState } from '@tanstack/react-query'

import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { environmentMutationKeys } from '@/lib/environments/utils/mutation-keys'

export function useWorkingMachines(): ReadonlySet<string> {
  const names = useMutationState(
    {
      filters: { mutationKey: environmentMutationKeys.all(), status: 'pending' },
      select: (mutation) => mutation.options.mutationKey?.[2] as string,
    },
    primaryQueryClient(),
  )
  return new Set(names)
}
