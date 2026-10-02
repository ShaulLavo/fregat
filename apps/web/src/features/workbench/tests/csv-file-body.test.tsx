import { createEditorTextBuffer, createEditorViewSession } from '@singapore-editor/core/document'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { CsvFileBody } from '@/features/workbench/components/csv-file-body'
import { useCsvPresentation } from '@/features/workbench/state/csv-presentation'
import * as engine from '@/features/workbench/utils/csv'
import { csvEngineQueryKeys } from '@/features/workbench/utils/query-keys'
import { tabId } from '@/lib/documents/utils/identity'

test('file query failures stay visible while the requested table choice survives retry', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(csvEngineQueryKeys.engine(), engine)
  const saved = useCsvPresentation.getState()
  const id = tabId('csv-read-error')
  const buffer = createEditorTextBuffer('name,count\npear,1')
  const view = createEditorViewSession(buffer)
  saved.setMode(id, 'table')
  const rendered = renderWithProviders(
    <CsvFileBody buffer={buffer} view={view} editable readFailed tabId={id}>
      <div>Source document and file read error</div>
    </CsvFileBody>,
    { queryClient },
  )
  try {
    await screen.findByText('Source document and file read error')
    expect(screen.queryByRole('table', { name: 'CSV rows' })).toBeNull()
    expect(screen.queryByRole('status', { name: 'Preparing CSV table' })).toBeNull()
    expect(useCsvPresentation.getState().tabs[id]?.mode).toBe('table')
    rendered.rerender(
      <CsvFileBody buffer={buffer} view={view} editable readFailed={false} tabId={id}>
        <div>Source document</div>
      </CsvFileBody>,
    )
    await screen.findByRole('table', { name: 'CSV rows' })
  } finally {
    rendered.unmount()
    queryClient.clear()
    useCsvPresentation.setState(saved, true)
  }
})

test('table readiness retains the whole source and switches only when the buffer is ready', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(csvEngineQueryKeys.engine(), engine)
  const saved = useCsvPresentation.getState()
  const id = tabId('csv-readiness')
  const buffer = createEditorTextBuffer('name,count\npear,1\n')
  const view = createEditorViewSession(buffer)
  const rendered = renderWithProviders(
    <CsvFileBody buffer={null} view={null} editable readFailed={false} tabId={id}>
      <div>Whole source document</div>
    </CsvFileBody>,
    { queryClient },
  )
  try {
    await screen.findByText('Whole source document')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByText('Whole source document')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status', { name: 'Preparing CSV table' })).toBeVisible()
    rendered.rerender(
      <CsvFileBody buffer={buffer} view={view} editable readFailed={false} tabId={id}>
        <div>Whole source document</div>
      </CsvFileBody>,
    )
    await screen.findByRole('table', { name: 'CSV rows' })
    expect(screen.queryByText('Whole source document')).toBeNull()
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('columnheader').map((heading) => heading.textContent)).toEqual([
      'Column 1',
      'Column 2',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'First row is header' }))
    await waitFor(() =>
      expect(screen.getAllByRole('columnheader').map((heading) => heading.textContent)).toEqual([
        'name',
        'count',
      ]),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    expect(screen.getByText('Whole source document')).toBeVisible()
    expect(useCsvPresentation.getState().tabs[id]).toEqual({ mode: 'text', header: true })
  } finally {
    rendered.unmount()
    queryClient.clear()
    useCsvPresentation.setState(saved, true)
  }
})
