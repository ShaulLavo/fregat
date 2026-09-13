import { useQuery } from '@tanstack/react-query'
import { parsePalette, type Palette } from '@workspace/contracts'

import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { paletteLibraryQueryKey } from '@/features/settings/utils/palette-library-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

/** The user's palettes on the primary server; empty until the list arrives. */
export function usePaletteLibrary(): readonly Palette[] {
  const owner = useSettingsOwner()
  const query = useQuery(
    {
      queryFn: async ({ client }) => {
        const response = await clientForQueryClient(client).themes.palettes.get()
        const documents = response.data?.palettes ?? []

        return documents.flatMap((document) => {
          const parsed = parsePalette(document, 'user')

          return parsed.success ? [parsed.palette] : []
        })
      },
      queryKey: paletteLibraryQueryKey,
      staleTime: Number.POSITIVE_INFINITY,
    },
    owner,
  )

  return query.data ?? EMPTY
}

const EMPTY: readonly Palette[] = []
