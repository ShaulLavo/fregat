import { fireEvent, screen } from '@testing-library/react'

import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { TouchRow } from '@/features/file-picker/components/touch-row'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FsEntry } from '@/lib/file-system-types'

test('one tap on a folder row opens it', () => {
  const opened: string[] = []
  let selections = 0
  const entry: FsEntry = {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: 'src',
    path: filesystemPath('src'),
    size: 0,
    type: 'directory',
    version: 'test',
  }
  renderWithProviders(
    <div role='listbox'>
      <TouchRow
        entry={entry}
        isBusy={false}
        onOpen={(tapped) => opened.push(tapped.name)}
        position={1}
        rowProps={{
          id: 'row-src',
          tabIndex: -1,
          onClick: () => {
            selections += 1
          },
          onMouseDown: () => undefined,
          'aria-selected': false,
          'data-active': undefined,
        }}
        selected={false}
        setSize={1}
        showPath={false}
      />
    </div>,
  )
  fireEvent.click(screen.getByRole('option'))
  expect(selections).toBe(1)
  expect(opened).toEqual(['src'])
})

test('a choosable file row shows its choice and a tap reaches the picker', () => {
  const tapped: string[] = []
  const entry: FsEntry = {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: 'notes.md',
    path: filesystemPath('notes.md'),
    size: 8,
    type: 'file',
    version: 'test',
  }
  const view = renderWithProviders(fileRow(entry, false, tapped))
  expect(screen.getByRole('option')).toHaveAttribute('aria-checked', 'false')
  fireEvent.click(screen.getByRole('option'))
  expect(tapped).toEqual(['notes.md'])

  view.rerender(fileRow(entry, true, tapped))
  expect(screen.getByRole('option')).toHaveAttribute('aria-checked', 'true')
})

function fileRow(entry: FsEntry, chosen: boolean, tapped: string[]) {
  return (
    <div role='listbox'>
      <TouchRow
        chosen={chosen}
        entry={entry}
        isBusy={false}
        onOpen={(row) => tapped.push(row.name)}
        position={1}
        rowProps={{
          id: 'row-notes',
          tabIndex: -1,
          onClick: () => undefined,
          onMouseDown: () => undefined,
          'aria-selected': false,
          'data-active': undefined,
        }}
        selected={false}
        setSize={1}
        showPath={false}
      />
    </div>
  )
}
