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
