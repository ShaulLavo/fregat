import { wallpaperMutationKeys } from '@/lib/theme-library/utils/keys'
import { useMutation } from '@tanstack/react-query'
import type { AssetId } from '@workspace/contracts'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'
import { wallpaperLibraryKey } from '@/lib/wallpapers/state/queries'

export function useWallpaperActions() {
  const owner = useSettingsOwner()
  const client = clientForQueryClient(owner)
  const defaults = {
    scope: { id: 'wallpaper-library' },
    retry: false,
    onSuccess: () => owner.invalidateQueries({ queryKey: wallpaperLibraryKey }),
  }
  const upload = useMutation(
    {
      ...defaults,
      mutationKey: wallpaperMutationKeys.upload,
      mutationFn: async (file: File) => {
        const response = await client.themes.wallpapers.post({ file })
        if (response.error) throw createRpcError(response.error)
        return response.data
      },
    },
    owner,
  )
  const remove = useMutation(
    {
      ...defaults,
      mutationKey: wallpaperMutationKeys.remove,
      mutationFn: async (id: AssetId) => {
        const response = await client.themes.wallpapers({ id }).delete.post()
        if (response.error) throw createRpcError(response.error)
        await owner.invalidateQueries({ queryKey: settingsKeys.document() })
        return response.data
      },
    },
    owner,
  )
  const importDirectory = useMutation(
    {
      ...defaults,
      mutationKey: wallpaperMutationKeys.import,
      mutationFn: async () => {
        const response = await client.themes.wallpapers['import-directory'].post({})
        if (response.error) throw createRpcError(response.error)
        return response.data
      },
    },
    owner,
  )
  return { upload, remove, importDirectory }
}
