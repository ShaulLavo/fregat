import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { FilesystemPath } from '@/lib/documents/utils/types'
import { fileOperationHistoryQuery } from '@/features/workspace/state/file-operations'

/** Keeps the shared file history loaded, so the tree's undo and redo commands know what they can do. */
export function useFileOperationHistory(rootPath: FilesystemPath) {
  const queryClient = useQueryClient()
  return useQuery(fileOperationHistoryQuery(queryClient, rootPath))
}
