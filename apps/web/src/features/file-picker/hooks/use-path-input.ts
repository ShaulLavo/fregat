import { filesystemPath } from '@/lib/documents/utils/identity'
import { errorMessage } from '@/lib/error-message'
import type { ServerInfo } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { statPath } from '@/lib/file-server'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { absolutePickerPath, parsePickerPathInput } from '@workspace/client-core/files/path-input'

export function useFilePickerPathInput({
  currentPath,
  onIntentStart,
  onNavigate,
  serverInfo,
}: {
  currentPath: string
  onIntentStart: () => number
  onNavigate: (path: string, intentId: number) => void
  serverInfo: ServerInfo | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const beginNavigationIntent = useEffectEvent(onIntentStart)
  const navigate = useEffectEvent(onNavigate)

  useEffect(() => {
    if (!isEditing) return

    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  useEffect(() => () => requestRef.current?.abort(), [])

  function open() {
    if (!serverInfo) return

    requestRef.current?.abort()
    setDraft(absolutePickerPath(currentPath, serverInfo.workspaceRoot))
    setError(null)
    setIsPending(false)
    setIsEditing(true)
  }

  function close() {
    requestRef.current?.abort()
    requestRef.current = null
    setError(null)
    setIsPending(false)
    setIsEditing(false)
  }

  function change(value: string) {
    setDraft(value)
    setError(null)
  }

  async function submit() {
    if (!serverInfo) return

    const parsed = parsePickerPathInput(draft, serverInfo)
    if (parsed.path === null) {
      setError(parsed.error)
      return
    }

    const intentId = beginNavigationIntent()
    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    setIsPending(true)
    setError(null)

    try {
      const entry = await statPath(filesystemPath(parsed.path), controller.signal)
      if (!isDirectoryEntry(entry)) {
        setError('That path is not a folder.')
        return
      }

      navigate(parsed.path, intentId)
      setIsEditing(false)
    } catch (cause) {
      if (controller.signal.aborted) return

      setError(errorMessage(cause, 'Could not open that folder.'))
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        setIsPending(false)
      }
    }
  }

  return {
    change,
    close,
    draft,
    error,
    inputRef,
    isEditing,
    isPending,
    open,
    submit,
  }
}
