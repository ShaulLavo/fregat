import { useMutation } from '@tanstack/react-query'
import type { ThemeDocument, ThemeId } from '@workspace/contracts'
import { refreshConfirmedSettings } from '@/features/settings/state/snapshot-admission'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { bundleMutationKeys, bundleQueryKey } from '@/features/settings/utils/bundle-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

export function useBundleActions() {
  const owner = useSettingsOwner()
  const client = clientForQueryClient(owner)
  const settle = async () => {
    await Promise.all([
      owner.invalidateQueries({ queryKey: bundleQueryKey }),
      owner.invalidateQueries({ queryKey: ['themes', 'palettes'] }),
      owner.invalidateQueries({ queryKey: ['themes', 'wallpapers'] }),
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
        await refreshConfirmedSettings(owner)
        return response.data
      },
      onSuccess: settle,
      scope: { id: 'theme-library' },
    },
    owner,
  )
  return { create, importArchive, importOmarchy, remove }
}
