import '@workspace/ui/globals.css'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { FilePickerDialog } from '@/components/file-picker-dialog'
import type { FsEntry } from '@/lib/file-system-types'
import { renderWithProviders } from '../../../../test/render'

afterEach(cleanup)

function choose(limit: number, picks: Array<readonly string[]>) {
  return (
    <FilePickerDialog
      files={{
        limit,
        startPath: 'picker/attach',
        onPick: (entries: readonly FsEntry[]) => picks.push(entries.map((entry) => entry.path)),
      }}
      onOpenChange={() => {}}
      open
    />
  )
}

// A row's name also carries its modified date.
function row(name: string) {
  return page.getByRole('option', { name: new RegExp(`^${name.replace('.', '\\.')}\\b`) })
}

test('on a desktop, files from two folders are chosen with clicks and attached together', async () => {
  await page.viewport(1440, 1000)
  const picks: Array<readonly string[]> = []
  renderWithProviders(choose(8, picks))

  await expect.element(page.getByRole('listbox', { name: 'Files and folders' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Attach', exact: true })).toBeDisabled()
  await expect.element(page.getByRole('tab', { name: 'Columns' })).not.toBeInTheDocument()

  await row('notes.md').click()
  await expect.element(row('notes.md')).toHaveAttribute('aria-checked', 'true')
  await expect.element(row('plan.txt')).toHaveAttribute('aria-checked', 'false')
  // A folder is never a choice; double clicking opens it.
  await row('docs').click()
  await expect.element(row('docs')).not.toHaveAttribute('aria-checked')
  await row('docs').dblClick()
  await row('guide.md').click()

  await expect.element(page.getByText('notes.md, guide.md')).toBeVisible()
  await page.getByRole('button', { name: 'Attach 2 files' }).click()

  await waitFor(() => expect(picks).toHaveLength(1))
  expect(picks[0]).toEqual(['picker/attach/notes.md', 'picker/attach/docs/guide.md'])
})

test('a second click takes a file out and a full set takes no more', async () => {
  await page.viewport(1440, 1000)
  const picks: Array<readonly string[]> = []
  renderWithProviders(choose(1, picks))

  await expect.element(page.getByText('Choose up to 1 file')).toBeVisible()
  await row('notes.md').click()
  await row('plan.txt').click()
  await expect.element(row('notes.md')).toHaveAttribute('aria-checked', 'true')
  await expect.element(row('plan.txt')).toHaveAttribute('aria-checked', 'false')
  await expect.element(page.getByText('notes.md (the most this message holds)')).toBeVisible()

  await row('notes.md').click()
  await expect.element(row('notes.md')).toHaveAttribute('aria-checked', 'false')
  await expect.element(page.getByRole('button', { name: 'Attach', exact: true })).toBeDisabled()
})

test('Space chooses the file under the cursor and Enter attaches the chosen files', async () => {
  await page.viewport(1440, 1000)
  const picks: Array<readonly string[]> = []
  renderWithProviders(choose(8, picks))

  await row('plan.txt').click()
  await row('plan.txt').click()
  await expect.element(row('plan.txt')).toHaveAttribute('aria-checked', 'false')
  await userEvent.keyboard(' ')
  await expect.element(row('plan.txt')).toHaveAttribute('aria-checked', 'true')
  await userEvent.keyboard('{Enter}')

  await waitFor(() => expect(picks).toHaveLength(1))
  expect(picks[0]).toEqual(['picker/attach/plan.txt'])
})

test('on a phone, a tap opens a folder, a tap chooses a file, and Back returns', async () => {
  await page.viewport(390, 844)
  renderWithProviders(choose(8, []))

  await row('notes.md').click()
  await expect.element(page.getByRole('button', { name: 'Attach 1 file' })).toBeEnabled()
  await row('docs').click()
  await row('guide.md').click()
  await expect.element(row('guide.md')).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Back to attach' }).click()
  await expect.element(row('notes.md')).toHaveAttribute('aria-checked', 'true')

  // The project's files lead the list; recent folders stay in the Places sheet.
  expect(screen.queryByText('Recent')).toBeNull()
  // Committing leaves through the system Back entries, which the app's router settles; the
  // composer scenario covers that end on a phone.
  await expect.element(page.getByRole('button', { name: 'Attach 2 files' })).toBeEnabled()
})
