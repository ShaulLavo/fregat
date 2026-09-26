import '@workspace/ui/globals.css'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { FilePickerDialog } from '@/components/file-picker-dialog'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { renderWithProviders } from '../../../../test/render'

afterEach(cleanup)

test('switching views keeps the entry selected in the deepest column', async () => {
  await page.viewport(1440, 1000)
  renderWithProviders(
    <FilePickerDialog
      open
      mode='file'
      value={{
        name: 'editor-tab-a.ts',
        path: filesystemPath('picker/editor-tab-a.ts'),
        type: 'file',
        size: 0,
        mtimeMs: 0,
        birthtimeMs: 0,
        version: 'test',
      }}
      onOpenChange={() => {}}
      onPick={() => {}}
    />,
  )
  await page.getByRole('tab', { name: 'Columns', exact: true }).click()
  await page.getByRole('option', { name: /picker-nested/ }).click()
  await page.getByRole('option', { name: 'note.md' }).click()

  await page.getByRole('tab', { name: 'List', exact: true }).click()
  await waitFor(() =>
    expect(screen.getByRole('option', { name: /note\.md/, selected: true })).toBeVisible(),
  )
  expect(screen.queryByRole('option', { name: /picker-nested/, selected: true })).toBeNull()

  await page.getByRole('tab', { name: 'Columns', exact: true }).click()
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'note.md', selected: true })).toBeVisible(),
  )
})
