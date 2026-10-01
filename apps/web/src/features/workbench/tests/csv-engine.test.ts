import { QueryClient } from '@tanstack/react-query'
import { expect, test } from '../../../../test/fixtures'
import { loadCsvEngineMutationOptions } from '@/features/workbench/utils/csv-engine'
import { csvEngineQueryKeys } from '@/features/workbench/utils/query-keys'
import { runMutation } from '@/lib/mutations/run'
import { useCsvPresentation } from '@/features/workbench/state/csv-presentation'
import { tabId } from '@/lib/documents/utils/identity'

test('engine imports settle the cache before resolving and concurrent loads reuse it', async () => {
  const client = new QueryClient()
  try {
    const options = loadCsvEngineMutationOptions(client)
    const first = runMutation(client, options, undefined)
    const second = runMutation(client, options, undefined)
    const loaded = await first
    expect(client.getQueryData(csvEngineQueryKeys.engine())).toBe(loaded)
    expect(await second).toBe(loaded)
    expect(loaded.parseCsv('a,b').kind).toBe('table')
  } finally {
    client.clear()
  }
})

test('table, text and header choices belong to each tab', () => {
  const saved = useCsvPresentation.getState()
  const first = tabId('csv-first')
  const second = tabId('csv-second')
  try {
    saved.setMode(first, 'table')
    saved.toggleHeader(first)
    saved.setMode(second, 'text')
    expect(useCsvPresentation.getState().tabs[first]).toEqual({ mode: 'table', header: true })
    expect(useCsvPresentation.getState().tabs[second]).toEqual({ mode: 'text', header: false })
    saved.setMode(first, 'text')
    saved.setMode(first, 'table')
    expect(useCsvPresentation.getState().tabs[first]?.header).toBe(true)
  } finally {
    useCsvPresentation.setState(saved, true)
  }
})
