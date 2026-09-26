import '@workspace/ui/globals.css'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { FilePickerDialog } from '@/components/file-picker-dialog'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { renderWithProviders } from '../../../../test/render'

afterEach(cleanup)

test('file type dropdown filters every view, clears hidden selection, and retains folders', async () => {
  const onOpenChange = vi.fn()
  await page.viewport(1440, 1000)
  const view = renderWithProviders(
    <FilePickerDialog
      open
      mode='file'
      accept={['.ts', '.md']}
      value={{
        name: 'editor-tab-a.ts',
        path: filesystemPath('picker/editor-tab-a.ts'),
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
  for (const mode of ['List', 'Icons', 'Columns']) {
    await page.getByRole('tab', { name: mode, exact: true }).click()
    if (mode === 'Columns')
      await waitFor(() =>
        expect(screen.getByRole('group', { name: 'Folder columns' })).toBeVisible(),
      )
    await page.getByRole('combobox', { name: 'File type' }).click()
    await page.getByRole('option', { name: 'Supported files (.ts, .md)', exact: true }).click()
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /editor-tab-a.ts/ })).toBeVisible(),
    )
    expect(screen.queryByRole('option', { name: /picker-ignored.txt/ })).toBeNull()
    await page.getByRole('option', { name: /editor-tab-a.ts/ }).click()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose file' })).toBeEnabled())
    await page.getByRole('combobox', { name: 'File type' }).click()
    await page.getByRole('option', { name: '.md', exact: true }).click()
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /editor-tab-a.ts/ })).toBeNull(),
    )
    expect(screen.getByRole('option', { name: /picker-notes.md/ })).toBeVisible()
    expect(screen.getByRole('option', { name: /picker-nested/ })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeDisabled()
  }
  await page.getByRole('option', { name: /picker-nested/ }).click()
  await waitFor(() => expect(screen.getByRole('option', { name: 'note.md' })).toBeVisible())
  await page.getByRole('textbox', { name: 'Search files' }).fill('picker')
  const trigger = screen.getByRole('combobox', { name: 'File type' })
  trigger.focus()
  await userEvent.keyboard('{ArrowDown}')
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'Supported files (.ts, .md)' })).toBeVisible(),
  )
  await userEvent.keyboard('{Escape}')
  expect(screen.getByRole('textbox', { name: 'Search files' })).toHaveValue('picker')
  expect(screen.getByRole('dialog', { name: 'Choose file' })).toBeVisible()
  expect(onOpenChange).not.toHaveBeenCalled()
  // Let the Escape finish closing the popup, so the click below opens it again.
  await waitFor(() =>
    expect(screen.queryByRole('option', { name: 'Supported files (.ts, .md)' })).toBeNull(),
  )
  await page.getByRole('combobox', { name: 'File type' }).click()
  // The popup renders after the click resolves.
  const combined = await screen.findByRole('option', { name: 'Supported files (.ts, .md)' })
  const textRange = document.createRange()
  textRange.selectNodeContents(combined)
  const popup = combined.closest('[data-slot=select-content]')
  if (!popup) throw new Error('File type popup is missing')
  expect(textRange.getBoundingClientRect().right).toBeLessThanOrEqual(
    popup.getBoundingClientRect().right,
  )
  await page.screenshot({ path: 'surface-file-picker-type-filter.png' })
  view.unmount()
  view.queryClient.clear()
}, 30_000)
