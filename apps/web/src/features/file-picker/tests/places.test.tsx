import { screen } from '@testing-library/react'
import { FilePickerDialog } from '@/components/file-picker-dialog'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('the sidebar lists only the home folders that exist', async ({ client }) => {
  await client.fs['create-folder'].post({ path: 'Documents' })
  renderWithProviders(
    <FilePickerDialog open value={null} onOpenChange={() => {}} onPick={() => {}} />,
  )

  expect((await screen.findAllByRole('button', { name: 'Documents' })).length).toBeGreaterThan(0)
  expect(screen.getAllByRole('button', { name: 'Home' }).length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: 'Desktop' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Downloads' })).toBeNull()
})
