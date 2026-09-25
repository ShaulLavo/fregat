import { paletteLibraryQueryKey } from '@/lib/theme-library/utils/query-keys'
import { useQuery } from '@tanstack/react-query'
import { parsePalette, type Palette } from '@workspace/contracts'

import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
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
          const parsed = parsePalette(document, document.source)

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
