import { fireEvent, screen } from '@testing-library/react'

import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { FileRow } from '@/features/file-picker/components/file-row'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FsEntry } from '@/lib/file-system-types'

test.each([
  [true, 'directory', ['src']],
  [false, 'directory', []],
  [true, 'file', []],
] as const)('openOnTap %s: one tap on a %s opens %j', (openOnTap, type, expected) => {
  const opened: string[] = []
  let selections = 0
  const entry: FsEntry = {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: 'src',
    path: filesystemPath('src'),
    size: 0,
    type,
    version: 'test',
  }
  renderWithProviders(
    <div role='listbox'>
      <FileRow
        entry={entry}
        isBusy={false}
        mode='folder'
        onDirectoryIntent={() => undefined}
        onDoubleClick={(tapped) => opened.push(tapped.name)}
        openOnTap={openOnTap}
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
  expect(opened).toEqual(expected)
})
