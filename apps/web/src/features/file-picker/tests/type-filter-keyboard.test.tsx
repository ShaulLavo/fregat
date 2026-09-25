import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { FilePickerDialog } from '@/components/file-picker-dialog'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('Escape closes the file-type popup without clearing the picker search', async ({ client }) => {
  const onOpenChange = vi.fn()
  await client.fs['create-file'].post({ path: 'notes.md' })
  renderWithProviders(
    <FilePickerDialog
      open
      mode='file'
      accept={['.ts', '.md']}
      value={{
        name: 'notes.md',
        path: filesystemPath('notes.md'),
        type: 'file',
        size: 0,
        mtimeMs: 0,
        birthtimeMs: 0,
        version: 'test',
      }}
      onOpenChange={onOpenChange}
      onPick={() => {}}
    />,
  )
  const search = await screen.findByRole('textbox', { name: 'Search files' })
  await screen.findByText('1 item')
  fireEvent.change(search, { target: { value: 'notes' } })
  fireEvent.click(screen.getByRole('combobox', { name: 'File type' }))
  const option = await screen.findByRole('option', { name: '.md' })
  fireEvent.keyDown(option, { key: 'Escape' })
  expect(search).toHaveValue('notes')
  await waitFor(() => expect(screen.queryByRole('option', { name: '.md' })).toBeNull())
  expect(screen.getByRole('dialog', { name: 'Choose file' })).toBeVisible()
  expect(onOpenChange).not.toHaveBeenCalled()
})
