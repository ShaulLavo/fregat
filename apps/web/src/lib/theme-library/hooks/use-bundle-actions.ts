import {
  paletteLibraryQueryKey,
  bundleQueryKey,
  bundleMutationKeys,
} from '@/lib/theme-library/utils/keys'
import { wallpaperLibraryKey } from '@/lib/wallpapers/state/queries'
import { useMutation } from '@tanstack/react-query'
import type { ThemeDocument, ThemeId } from '@workspace/contracts'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

export function useBundleActions() {
  const owner = useSettingsOwner()
  const client = clientForQueryClient(owner)
  const settle = async () => {
    await Promise.all([
      owner.invalidateQueries({ queryKey: bundleQueryKey }),
      owner.invalidateQueries({ queryKey: paletteLibraryQueryKey }),
      owner.invalidateQueries({ queryKey: wallpaperLibraryKey }),
    ])
  }
  const create = useMutation(
    {
      mutationKey: bundleMutationKeys.create,
      mutationFn: async (document: ThemeDocument) => {
        const response = await client.themes.bundles.post(document)
        if (response.error) throw createRpcError(response.error)
        return response.data
      },
      onSuccess: settle,
      scope: { id: 'theme-library' },
    },
    owner,
  )
  const importArchive = useMutation(
    {
      mutationKey: bundleMutationKeys.import,
      mutationFn: async (file: File) => {
        const response = await client.themes.bundles.import.post(JSON.parse(await file.text()))
        if (response.error) throw createRpcError(response.error)
        return response.data
      },
      onSuccess: settle,
      scope: { id: 'theme-library' },
    },
    owner,
  )
  const importOmarchy = useMutation(
    {
      mutationKey: bundleMutationKeys.omarchy,
      mutationFn: async (name: string) => {
        const response = await client.themes.bundles.omarchy.post(name)
        if (response.error) throw createRpcError(response.error)
        return response.data
      },
      onSuccess: settle,
      scope: { id: 'theme-library' },
    },
    owner,
  )
  const remove = useMutation(
    {
      mutationKey: bundleMutationKeys.remove,
      mutationFn: async (id: ThemeId) => {
        const response = await client.themes.bundles({ id }).delete.post()
        if (response.error) throw createRpcError(response.error)
        await owner.invalidateQueries({ queryKey: settingsKeys.document() })
        return response.data
      },
      onSuccess: settle,
      scope: { id: 'theme-library' },
    },
    owner,
  )
  return { create, importArchive, importOmarchy, remove }
}
