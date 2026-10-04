import { useQuery } from '@tanstack/react-query'
import { shortcutMetadataQueryOptions } from '@/features/settings/utils/shortcut-metadata-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function useShortcutMetadata() {
  return useQuery(shortcutMetadataQueryOptions(), resourceQueryClient)
}
