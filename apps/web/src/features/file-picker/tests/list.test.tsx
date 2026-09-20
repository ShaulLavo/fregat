import { screen } from '@testing-library/react'

import { expect, test } from '../../../../test/fixtures'
import { FileList } from '@/features/file-picker/components/list'
import { FilePickerSessionActionsContext } from '@/features/file-picker/providers/session-actions-context'
import type { FsEntry } from '@/lib/file-system-types'
import { renderWithProviders } from '../../../../test/render'

const actions = {
  jumpTo: () => undefined,
  navigateTo: () => undefined,
  revealEntry: () => undefined,
  selectEntry: () => undefined,
}

test('keeps the listbox focused while loading and when a folder is empty', () => {
  const view = renderList([], { status: 'loading' })
  const listbox = screen.getByRole('listbox', { name: 'Folders and files' })

  listbox.focus()
  expect(document.activeElement).toBe(listbox)
  expect(screen.getByRole('status', { name: 'Loading folder' })).toBeInTheDocument()

  view.rerender(pickerList([], { status: 'ready', data: [] }))

  expect(document.activeElement).toBe(listbox)
  expect(screen.getByText('Nothing here')).toBeInTheDocument()
})

function renderList(entries: FsEntry[], loadState: Parameters<typeof pickerList>[1]) {
  return renderWithProviders(pickerList(entries, loadState))
}

function pickerList(
  entries: FsEntry[],
  loadState: Parameters<typeof FileList>[0]['loadState'],
  options: {
    listRef?: Parameters<typeof FileList>[0]['listRef']
    selectedPath?: string | null
  } = {},
) {
  return (
    <FilePickerSessionActionsContext value={actions}>
      <FileList
        entries={entries}
        iconMode='default'
        isBusy={false}
        isSearching={false}
        loadState={loadState}
        listRef={options.listRef}
        mode='folder'
        onDirectoryIntent={() => undefined}
        onEntryDoubleClick={() => undefined}
        onCommitEntry={() => undefined}
        onGoParent={() => undefined}
        onRetry={() => undefined}
        selectedPath={options.selectedPath ?? null}
      />
    </FilePickerSessionActionsContext>
  )
}
