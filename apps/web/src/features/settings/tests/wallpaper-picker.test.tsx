import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ThemeAwareToaster } from '@/components/theme-aware-toaster'
import { getClient } from '@/lib/client'
import { fetchSettings } from '@/features/settings/utils/api'
import { selectSettingsCategory } from '@/features/settings/state/category-store'
import { selectSettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsSearch } from '@/features/settings/state/search-store'
import { selectSettingsView } from '@/features/settings/state/view-store'

import { secondWallpaperPng, wallpaperPng } from '../../../../test/factories/wallpaper'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { SettingsPage } from '../components/page'

test.beforeEach(() => {
  selectSettingsScope('user')
  selectSettingsView('form')
  selectSettingsSearch('wallpaper')
  selectSettingsCategory(null)
})

async function openPicker(mode: 'light' | 'dark') {
  renderWithProviders(
    <>
      <SettingsPage />
      <ThemeAwareToaster />
    </>,
  )
  await userEvent.click(await screen.findByRole('button', { name: `Choose ${mode} wallpaper` }))
  return screen.findByRole('dialog')
}

test('several uploads land under Your uploads and the last one becomes the selection', async ({
  client,
}) => {
  const dialog = await openPicker('light')
  const files = [
    new File([wallpaperPng()], 'first.png', { type: 'image/png' }),
    new File([secondWallpaperPng()], 'second.png', { type: 'image/png' }),
  ]
  await userEvent.upload(within(dialog).getByLabelText('Upload wallpapers'), files)

  const uploads = within(await within(dialog).findByRole('region', { name: 'Your uploads' }))
  const second = await uploads.findByRole('button', { name: 'Select second.png' })
  expect(await uploads.findByRole('button', { name: 'Select first.png' })).toBeInTheDocument()
  await waitFor(() => expect(second).toHaveAttribute('aria-pressed', 'true'))
  const assets = (await client.themes.wallpapers.get()).data!.assets
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['workbench.wallpaper'].light).toEqual({
      kind: 'library',
      asset: assets.find((asset) => asset.name === 'second.png')!.id,
    })
  })
})

test('a file that is not an image is refused and the selection stays', async ({ client }) => {
  const dialog = await openPicker('dark')
  const input = within(dialog).getByLabelText('Upload wallpapers')
  await userEvent.upload(input, new File(['nope'], 'broken.png', { type: 'image/png' }))

  expect(await screen.findByText('broken.png was not added')).toBeInTheDocument()
  expect((await client.themes.wallpapers.get()).data?.assets).toEqual([])
  expect(within(dialog).getByRole('button', { name: 'Desktop' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('delete is offered on an upload and not on an imported background', async ({
  client,
  server,
}) => {
  const backgrounds = path.join(server.root, 'seed/night/backgrounds')
  await mkdir(backgrounds, { recursive: true })
  await writeFile(path.join(backgrounds, '1-lake.png'), secondWallpaperPng())
  await client.themes.wallpapers['import-directory'].post({ path: path.join(server.root, 'seed') })
  await client.themes.wallpapers.post({ file: new File([wallpaperPng()], 'mine.png') })

  const dialog = within(await openPicker('dark'))
  const imported = within(await dialog.findByRole('region', { name: 'Night' }))
  expect(
    await imported.findByRole('button', { name: 'Select night · 1-lake.png' }),
  ).toHaveTextContent('lake')
  expect(imported.queryByRole('button', { name: /^Actions for/u })).toBeNull()

  await userEvent.click(await dialog.findByRole('button', { name: 'Actions for mine.png' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  await waitFor(async () =>
    expect((await client.themes.wallpapers.get()).data?.assets.map((asset) => asset.name)).toEqual([
      'night · 1-lake.png',
    ]),
  )
})
