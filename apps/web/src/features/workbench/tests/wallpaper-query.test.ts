import { QueryClient } from '@tanstack/react-query'
import { expect, test } from '../../../../test/fixtures'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { primaryServerOrigin, serverEndpoint } from '@/lib/client'
import {
  wallpaperInfoQueryOptions,
  wallpaperMediaQueryOptions,
  wallpaperStillUrl,
} from '@/features/workbench/state/wallpaper-query'

test('the first still image has a stable browser-cacheable primary endpoint', () => {
  const primary = primaryServerOrigin()
  expect(wallpaperStillUrl(primary)).toBe(`${serverEndpoint(primary)}/wallpaper/still`)
})

test('a remote workbench returns the bundled fallback without fetching remote wallpaper', async ({
  client,
}) => {
  const queryClient = new QueryClient()
  registerEnvironmentQueryClient(queryClient, 'http://localhost:39078', client)
  try {
    await expect(queryClient.query(wallpaperInfoQueryOptions({ enabled: true }))).resolves.toBe(
      'image',
    )
    expect(wallpaperStillUrl('http://localhost:39078')).toBeNull()
    await expect(
      queryClient.query(wallpaperMediaQueryOptions({ enabled: true })),
    ).resolves.toBeNull()
  } finally {
    queryClient.clear()
  }
})
