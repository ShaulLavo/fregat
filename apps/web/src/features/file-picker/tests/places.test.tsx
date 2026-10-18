import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import path from 'node:path'
import { rm } from 'node:fs/promises'
import { createObservedInProcessClient } from '../../../../test/client'
import { createRequestGate } from '../../../../test/factories/request-gate'
import { installTestClient } from '../../../../test/factories/client-binding'
import { directoryQueryOptions } from '@/features/file-picker/utils/directory-query'
import { DeferredFilePickerDialog } from '@/components/deferred-file-picker-dialog'
import { expect, test } from '../../../../test/fixtures'
import { renderWithLoadedDialogs } from '../../../../test/render'

test('the sidebar lists only the home folders that exist', async ({ client }) => {
  await client.fs['create-folder'].post({ path: 'Documents' })
  await renderWithLoadedDialogs(
    <DeferredFilePickerDialog open value={null} onOpenChange={() => {}} onPick={() => {}} />,
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
  await renderWithLoadedDialogs(
    <DeferredFilePickerDialog open value={null} onOpenChange={() => {}} onPick={() => {}} />,
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

test.for(['cancel', 'removed'] as const)(
  'a %s typed folder leaves the original location available after its listing settles',
  async (outcome, { server, client }) => {
    await client.fs['create-folder'].post({ path: 'pending-target' })
    const gate = createRequestGate((request) => {
      const url = new URL(request.url)
      return url.pathname === '/fs/tree' && url.searchParams.get('path') === 'pending-target'
    })
    const restore = installTestClient(createObservedInProcessClient(server, gate.beforeRequest))
    const rendered = await renderWithLoadedDialogs(
      <DeferredFilePickerDialog open value={null} onOpenChange={() => {}} onPick={() => {}} />,
    )
    try {
      const picker = await screen.findByRole('dialog', { name: 'Choose folder' })
      await userEvent.click(within(picker).getByRole('button', { name: 'Go to folder' }))
      const input = within(picker).getByRole('textbox', { name: 'Folder path' })
      await waitFor(() => expect(input).toBeEnabled())
      await userEvent.clear(input)
      await userEvent.type(input, `${path.join(server.root, 'pending-target')}{Enter}`)
      await gate.entered
      expect(within(picker).getByRole('button', { name: /^Open$/ })).toBeDisabled()
      if (outcome === 'cancel')
        await userEvent.click(within(picker).getByRole('button', { name: 'Cancel path entry' }))
      if (outcome === 'removed')
        await rm(path.join(server.root, 'pending-target'), { recursive: true })
      await act(async () => {
        gate.release()
        await rendered.queryClient
          .query(directoryQueryOptions({ path: 'pending-target', query: '', showHidden: false }))
          .catch(() => undefined)
      })
      expect(picker.querySelector('button[title="pending-target"]')).toBeNull()
      expect(within(picker).getByRole('button', { name: /^Open$/ })).toBeEnabled()
      if (outcome === 'cancel') expect(input).not.toBeVisible()
      if (outcome === 'removed') {
        expect(input).toBeVisible()
        expect(input).toHaveValue(path.join(server.root, 'pending-target'))
        expect(input).toBeEnabled()
      }
    } finally {
      gate.release()
      rendered.unmount()
      restore()
    }
  },
)
