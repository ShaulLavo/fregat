import { directoryQueryOptions } from '@/features/file-picker/utils/directory-query'
import { errorMessage } from '@/lib/error-message'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { toast } from 'sonner'

import type { FilePickerMode } from '@/features/file-picker/utils/model'

export function useDirectoryTransition({
  currentPath,
  enabled,
  mode,
  showHidden,
}: {
  currentPath: string
  enabled: boolean
  mode: FilePickerMode
  showHidden: boolean
}) {
  const queryClient = useQueryClient()
  const requestIdRef = useRef(0)

  useLayoutEffect(() => {
    requestIdRef.current += 1
  }, [currentPath, enabled, mode, showHidden])

  useEffect(
    () => () => {
      requestIdRef.current += 1
    },
    [],
  )

  const beginDirectoryIntent = () => {
    requestIdRef.current += 1
    return requestIdRef.current
  }

  const preloadDirectory = (path: string) => {
    if (!enabled || path === currentPath) return

    return queryClient.prefetchQuery(directoryQueryOptions({ mode, path, query: '', showHidden }))
  }

  const loadDirectory = async (path: string, intentId?: number) => {
    if (!enabled) return false

    const requestId = intentId ?? beginDirectoryIntent()
    if (requestId !== requestIdRef.current) return false
    if (path === currentPath) {
      return true
    }

    try {
      await queryClient.fetchQuery(directoryQueryOptions({ mode, path, query: '', showHidden }))
    } catch (cause) {
      if (requestId !== requestIdRef.current) return false

      toast.error('Could not open folder', {
        description: errorMessage(cause, 'The folder could not be loaded.'),
      })
      return false
    }

    return requestId === requestIdRef.current
  }

  return { beginDirectoryIntent, loadDirectory, preloadDirectory }
}
