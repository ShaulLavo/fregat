import { getClient } from '@/lib/client'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { DEFAULT_SETTING_VALUES, type SettingsSnapshot } from '@workspace/contracts'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'

import { expect, test } from '../../../../test/fixtures'
import { FileList } from '@/features/file-picker/list'
import { FilePickerSessionActionsContext } from '@/features/file-picker/providers/session-actions-context'
import { saveSettings } from '@/features/settings/utils/api'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import type { FsEntry } from '@/lib/file-system-types'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'

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

test('exposes complete positions for virtualized options', () => {
  const entries = [entry('alpha.ts'), entry('beta.ts'), entry('gamma.ts')]

  renderList(entries, { status: 'ready', data: entries })

  expect(
    screen.getAllByRole('option').map((option) => ({
      position: option.getAttribute('aria-posinset'),
      size: option.getAttribute('aria-setsize'),
    })),
  ).toEqual([
    { position: '1', size: '3' },
    { position: '2', size: '3' },
    { position: '3', size: '3' },
  ])
})

test('keeps cozy painted rows aligned with the virtual list height', async ({ client }) => {
  expect(client).toBeDefined()
  await saveSettings(
    {
      mutationId: 'file-picker-density-cozy',
      operations: [{ key: 'workbench.density', kind: 'set', value: 'cozy' }],
      target: 'user',
    },
    getClient(),
  )
  const entries = [entry('alpha.ts'), entry('beta.ts')]

  renderList(entries, { status: 'ready', data: entries })

  await waitFor(() => {
    const firstOption = screen.getAllByRole('option')[0]
    expect(firstOption?.parentElement).toHaveStyle({ height: '32px' })
  })

  const listbox = screen.getByRole('listbox', { name: 'Folders and files' })
  expect(listbox.firstElementChild).toHaveStyle({ height: '64px' })
})

test('preserves a scrolled list without a selection when density changes', async () => {
  await expectDensityChangeToPreserveScroll(null)
})

test('does not reveal an offscreen selection when only density changes', async () => {
  await expectDensityChangeToPreserveScroll('entry-90')
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
        onKeyDown={() => undefined}
        onRetry={() => undefined}
        selectedPath={options.selectedPath ?? null}
      />
    </FilePickerSessionActionsContext>
  )
}

async function expectDensityChangeToPreserveScroll(selectedPath: string | null) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), settingsSnapshot('compact'))
  const entries = Array.from({ length: 100 }, (_, index) => entry(`entry-${index}`))
  renderWithProviders(
    pickerList(
      entries,
      { status: 'ready', data: entries },
      { listRef: setListboxHeight, selectedPath },
    ),
    { queryClient },
  )
  const listbox = screen.getByRole('listbox', { name: 'Folders and files' })

  listbox.scrollTop = 533
  fireEvent.scroll(listbox)
  expect(listbox.scrollTop).toBe(533)

  act(() => {
    queryClient.setQueryData(settingsKeys.document(), settingsSnapshot('cozy'))
  })

  await waitFor(() => expect(listbox.scrollTop).toBe(656))
}

function setListboxHeight(element: HTMLDivElement | null) {
  if (!element) return

  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 260 })
}

function settingsSnapshot(
  density: SettingsSnapshot['values']['workbench.density'],
): SettingsSnapshot {
  return {
    diagnostics: [],
    layers: [],
    serverVersion: { epoch: 'file-picker-test', sequence: density === 'compact' ? 1 : 2 },
    values: { ...DEFAULT_SETTING_VALUES, 'workbench.density': density },
  }
}

function entry(path: string): FsEntry {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: path,
    path: filesystemPath(path),
    size: 0,
    type: 'file',
    version: '1',
  }
}
