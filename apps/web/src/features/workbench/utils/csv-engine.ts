import { mutationOptions, type QueryClient } from '@tanstack/react-query'
import { workbenchMutationKeys } from '@/features/workbench/utils/mutation-keys'
import { csvEngineQueryKeys } from '@/features/workbench/utils/query-keys'

export type CsvEngine = typeof import('@/features/workbench/utils/csv')

export function loadCsvEngineMutationOptions(client: QueryClient) {
  return mutationOptions({
    mutationKey: workbenchMutationKeys.loadCsvEngine(),
    scope: { id: 'csv-engine' },
    retry: false,
    mutationFn: async () => {
      const cached = client.getQueryData<CsvEngine>(csvEngineQueryKeys.engine())
      if (cached) return cached
      const engine = await import('@/features/workbench/utils/csv')
      client.setQueryData(csvEngineQueryKeys.engine(), engine)
      return engine
    },
  })
}
