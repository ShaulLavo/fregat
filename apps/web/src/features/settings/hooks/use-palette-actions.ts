import { useMutation } from '@tanstack/react-query'
import { serializePalette, type Palette, type PaletteId } from '@workspace/contracts'

import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { paletteLibraryQueryKey } from '@/features/settings/utils/palette-library-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

/** Library writes on the primary server. Selection stays a settings write. */
export function usePaletteActions() {
  const owner = useSettingsOwner()
  const client = () => clientForQueryClient(owner)
  const invalidate = () => owner.invalidateQueries({ queryKey: paletteLibraryQueryKey })

  const create = useMutation(
    {
      mutationKey: ['themes', 'palettes', 'create'],
      mutationFn: async (palette: Palette) => {
        const response = await client().themes.palettes.post(serializePalette(palette))
        if (response.error) throw createRpcError(response.error)

        return response.data
      },
      onSuccess: invalidate,
      retry: false,
    },
    owner,
  )
  const update = useMutation(
    {
      mutationKey: ['themes', 'palettes', 'update'],
      mutationFn: async (palette: Palette) => {
        const response = await client()
          .themes.palettes({ id: palette.id })
          .post(serializePalette(palette))
        if (response.error) throw createRpcError(response.error)

        return response.data
      },
      onSuccess: invalidate,
      retry: false,
    },
    owner,
  )
  const remove = useMutation(
    {
      mutationKey: ['themes', 'palettes', 'delete'],
      mutationFn: async (id: PaletteId) => {
        const response = await client().themes.palettes({ id }).delete.post()
        if (response.error) throw createRpcError(response.error)

        return response.data
      },
      onSuccess: invalidate,
      retry: false,
    },
    owner,
  )

  return { create, update, remove }
}
