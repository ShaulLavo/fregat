import { filesystemPath } from '@/lib/documents/utils/identity'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { errorMessage } from '@/lib/error-message'
import type { ServerInfo } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { statPath } from '@/lib/file-server'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { absolutePickerPath, parsePickerPathInput } from '@workspace/client-core/files/path-input'

type FolderProbe = { kind: 'folder' } | { kind: 'rejected'; message: string }

// Outside the hook: React Compiler cannot lower a `try`/`finally`, and the caller needs one
// settlement path whether the stat resolved, rejected or named something that is not a folder.
async function probeFolder(
  path: string,
  signal: AbortSignal,
  client: ReturnType<typeof clientForQueryClient>,
): Promise<FolderProbe> {
  try {
    const entry = await statPath(filesystemPath(path), signal, client)
    if (isDirectoryEntry(entry)) return { kind: 'folder' }
    return { kind: 'rejected', message: 'That path is not a folder.' }
  } catch (cause) {
    return { kind: 'rejected', message: errorMessage(cause, 'Could not open that folder.') }
  }
}

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
  const client = clientForQueryClient(useQueryClient())
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    if (!isEditing) return

    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  useEffect(() => () => requestRef.current?.abort(), [client])

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

    const intentId = onIntentStart()
    const navigate = onNavigate
    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    setIsPending(true)
    setError(null)

    const probe = await probeFolder(parsed.path, controller.signal, client)
    const current = requestRef.current === controller
    if (current) {
      requestRef.current = null
      setIsPending(false)
    }
    if (controller.signal.aborted || !current) return
    if (probe.kind !== 'folder') {
      setError(probe.message)
      return
    }

    navigate(parsed.path, intentId)
    setIsEditing(false)
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
