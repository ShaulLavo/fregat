import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

test('pinning the open folder adds it to Pinned, and a removed place comes back', async ({
  client,
}) => {
  await client.fs['create-folder'].post({ path: 'Documents' })
  renderWithProviders(
    <FilePickerDialog open value={null} onOpenChange={() => {}} onPick={() => {}} />,
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Pin this folder' }))
  const pinned = await screen.findByRole('region', { name: 'Pinned' })
  expect(within(pinned).getAllByRole('button').length).toBe(1)
  expect(screen.getByRole('button', { name: 'Unpin this folder' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const places = await screen.findByRole('region', { name: 'Places' })
  fireEvent.contextMenu(await within(places).findByRole('button', { name: 'Documents' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove from sidebar' }))
  // Home sits in Pinned now, so removing Documents empties Places.
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Places' })).toBeNull())

  fireEvent.contextMenu(within(pinned).getByRole('button'))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Show removed locations/ }))
  const restored = await screen.findByRole('region', { name: 'Places' })
  expect(within(restored).getByRole('button', { name: 'Documents' })).toBeDefined()
})
