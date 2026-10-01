import { mutationOptions, type QueryClient } from '@tanstack/react-query'
import { workbenchMutationKeys } from '@/features/workbench/utils/mutation-keys'
import type { CsvEngine } from '@/features/workbench/utils/csv-engine'

export type CsvPresentationModule = {
  readonly Table: typeof import('@/features/workbench/components/csv-table').CsvTable
  readonly Actions: typeof import('@/features/workbench/components/csv-table-actions').CsvTableActions
  readonly engine?: CsvEngine
}
export type CsvPreparedPresentation = CsvPresentationModule & { readonly engine: CsvEngine }

export function loadCsvPresentationMutationOptions(client: QueryClient) {
  return mutationOptions({
    mutationKey: workbenchMutationKeys.loadCsvPresentation(),
    scope: { id: 'csv-presentation' },
    retry: false,
    mutationFn: async () => {
      const presentation = await import('@/features/workbench/utils/csv-presentation')
      return presentation.prepareCsvPresentation(client)
    },
  })
}
