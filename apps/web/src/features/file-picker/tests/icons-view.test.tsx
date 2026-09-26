import { createRef } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { IconsView } from '@/features/file-picker/components/icons-view'
import { FilePickerSessionActionsContext } from '@/features/file-picker/providers/session-actions-context'
import type { EntriesLoadState } from '@/features/file-picker/utils/model'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

function icons(loadState: EntriesLoadState, onRetry = () => {}) {
  return (
    <FilePickerSessionActionsContext
      value={{ jumpTo() {}, navigateTo() {}, revealEntry() {}, selectEntry() {} }}
    >
      <IconsView
        entries={[]}
        isBusy={false}
        listRef={createRef()}
        mode='folder'
        selectedPath={null}
        loadState={loadState}
        onRetry={onRetry}
        onCommitEntry={() => {}}
        onEntryDoubleClick={() => {}}
        onGoParent={() => {}}
      />
    </FilePickerSessionActionsContext>
  )
}

test('icons distinguish loading from an empty folder', () => {
  const view = renderWithProviders(icons({ status: 'loading' }))
  expect(screen.getByRole('status', { name: 'Loading folder' })).toBeInTheDocument()
  expect(screen.queryByText('Nothing here')).not.toBeInTheDocument()

  view.rerender(icons({ status: 'ready', data: [] }))
  expect(screen.getByText('Nothing here')).toBeInTheDocument()
  expect(screen.queryByRole('status', { name: 'Loading folder' })).not.toBeInTheDocument()
})

test('icons show read failures and allow a retry', () => {
  let retries = 0
  renderWithProviders(
    icons({ status: 'error', message: 'Access denied' }, () => {
      retries += 1
    }),
  )
  expect(screen.getByText('Could not load this folder')).toBeInTheDocument()
  expect(screen.getByText('Access denied')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retries).toBe(1)
})
