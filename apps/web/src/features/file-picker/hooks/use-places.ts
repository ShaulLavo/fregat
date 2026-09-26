import { useQuery } from '@tanstack/react-query'

import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { ServerInfo } from '@/lib/file-system-types'
import { filePickerKeys } from '@/lib/query-keys'
import { fetchPlaces } from '@/features/file-picker/utils/data-helpers'

/** The browsed machine's places, project folders and drives; null until it answers. */
export function usePlaces(open: boolean, serverInfo: ServerInfo | null) {
  const query = useQuery({
    enabled: open && Boolean(serverInfo),
    queryFn: ({ signal, client }) => fetchPlaces(signal, clientForQueryClient(client)),
    queryKey: filePickerKeys.places(),
  })

  return { places: query.data ?? null, refresh: query.refetch }
}
