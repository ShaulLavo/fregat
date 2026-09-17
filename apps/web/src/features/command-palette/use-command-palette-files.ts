import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { LoadState } from '@/lib/load-state'
import { fetchQuickOpenFiles } from '@/lib/file-server'
import { fileSystemKeys } from '@/lib/query-keys'
import type { TreeModel } from '@/lib/tree-model'
import { useQuery } from '@tanstack/react-query'
import { useLayoutEffect, useState } from 'react'

import type { QuickAccessMode } from '@/features/command-palette/command-palette-types'
import {
  filePaletteItems,
  searchFilePaletteItems,
  selectedFileCommandValue,
} from '@/features/command-palette/command-palette-utils'

type UseCommandPaletteFilesOptions = {
  readonly mode: QuickAccessMode
  readonly open: boolean
  readonly query: string
  readonly rootPath: FilesystemPath | null
  readonly treeState: LoadState<TreeModel>
}

export function useCommandPaletteFiles({
  mode,
  open,
  query,
  rootPath,
  treeState,
}: UseCommandPaletteFilesOptions) {
  const [selectedFileItemValue, setSelectedFileItemValue] = useState<string | null>(null)
  const fileQuery = query.trim()
  const baseFileItems = filePaletteItems(treeState)
  const fileSearchEnabled = open && mode === 'files' && rootPath !== null && fileQuery.length > 0
  const fileSearchQuery = useQuery({
    enabled: fileSearchEnabled,
    queryFn: ({ signal, client }) =>
      fetchQuickOpenFiles(
        {
          path: rootPath ?? filesystemPath(''),
          query: fileQuery,
          signal,
        },
        clientForQueryClient(client),
      ),
    // Never cached: a remembered miss would hide a file created since the last search.
    gcTime: 0,
    queryKey: fileSystemKeys.quickOpenFiles(rootPath ?? '', fileQuery),
    staleTime: 0,
  })
  const searchedFileItems = searchFilePaletteItems(fileSearchQuery.data ?? [], rootPath ?? '')
  const visibleFileItems = fileSearchEnabled ? searchedFileItems : baseFileItems
  const selectedCommandValue =
    mode === 'files' ? selectedFileCommandValue(selectedFileItemValue, visibleFileItems) : undefined

  useLayoutEffect(() => {
    if (!open || mode !== 'files') return
    //TODO this seems a bit hacky, do we even want to do this? if so use a ref at least
    document.querySelector<HTMLElement>('[data-slot="command-list"]')?.scrollTo({ top: 0 })
  }, [fileQuery, fileSearchQuery.data, mode, open])

  return {
    fileQuery,
    fileSearchQuery,
    selectedCommandValue,
    setSelectedFileItemValue,
    visibleFileItems,
  }
}
