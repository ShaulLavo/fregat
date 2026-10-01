import type { QueryClient } from '@tanstack/react-query'
import { runMutation } from '@/lib/mutations/run'
import { CsvTable } from '@/features/workbench/components/csv-table'
import { CsvTableActions } from '@/features/workbench/components/csv-table-actions'
import { loadCsvEngineMutationOptions } from '@/features/workbench/utils/csv-engine'
import { csvPresentationQueryKeys } from '@/features/workbench/utils/query-keys'
import type {
  CsvPreparedPresentation,
  CsvPresentationModule,
} from '@/features/workbench/utils/csv-presentation-loader'

export async function prepareCsvPresentation(
  client: QueryClient,
): Promise<CsvPreparedPresentation> {
  let presentation = client.getQueryData<CsvPresentationModule>(
    csvPresentationQueryKeys.presentation(),
  )
  if (presentation && hasEngine(presentation)) return presentation
  if (!presentation) {
    presentation = { Table: CsvTable, Actions: CsvTableActions }
    // Publish loaded controls so the shell can distinguish a later parser import failure.
    client.setQueryData(csvPresentationQueryKeys.presentation(), presentation)
  }
  const prepared = {
    ...presentation,
    engine: await runMutation(client, loadCsvEngineMutationOptions(client), undefined),
  }
  // TanStack may structurally share the prepared object with the published controls.
  client.setQueryData(csvPresentationQueryKeys.presentation(), prepared)
  return client.getQueryData<CsvPreparedPresentation>(csvPresentationQueryKeys.presentation())!
}

function hasEngine(presentation: CsvPresentationModule): presentation is CsvPreparedPresentation {
  return presentation.engine !== undefined
}
