import type { WatchServerMessage } from '@workspace/contracts'
import type { Client } from '@/lib/client'
import { streamWorkspaceEvents } from '@/features/workspace/state/event-stream'

type FileStream = {
  readonly controller: AbortController
  readonly files: readonly string[]
}

export function startWorkspaceEventStreams({
  client,
  rootPath,
  onMessage,
  onFilesReady,
  onError,
}: {
  client: Client
  rootPath: string
  onMessage: (message: WatchServerMessage) => void
  onFilesReady: (files: readonly string[]) => void
  onError: (error: unknown) => void
}) {
  const project = new AbortController()
  let current: FileStream | null = null
  let pending: FileStream | null = null

  void streamWorkspaceEvents(client, rootPath, project.signal, (message) => {
    if (!project.signal.aborted) onMessage(message)
  }).catch((error: unknown) => {
    if (!project.signal.aborted) onError(error)
  })

  function receive(stream: FileStream, message: WatchServerMessage) {
    if (stream.controller.signal.aborted || project.signal.aborted) return
    if (message.type !== 'ready') {
      onMessage(message)
      return
    }
    if (pending !== stream) return
    const previousFiles = new Set(current?.files)
    const added = stream.files.filter((file) => !previousFiles.has(file))
    // The old stream covers retained files until its replacement has attached every watch.
    current?.controller.abort()
    current = stream
    pending = null
    if (added.length > 0) onFilesReady(added)
  }

  function setFiles(paths: readonly string[]) {
    if (project.signal.aborted) return
    const files = [...new Set(paths)].sort()
    const desired = pending ?? current
    if (desired && sameFiles(desired.files, files)) return
    pending?.controller.abort()
    pending = null
    if (current && sameFiles(current.files, files)) return
    if (files.length === 0) {
      current?.controller.abort()
      current = null
      return
    }
    const stream: FileStream = { controller: new AbortController(), files }
    pending = stream
    void streamWorkspaceEvents(
      client,
      rootPath,
      stream.controller.signal,
      (message) => receive(stream, message),
      files,
      'files',
    ).catch((error: unknown) => {
      if (stream.controller.signal.aborted) return
      if (pending === stream) pending = null
      onError(error)
    })
  }

  return {
    setFiles,
    close() {
      project.abort()
      pending?.controller.abort()
      current?.controller.abort()
      pending = null
      current = null
    },
  }
}

function sameFiles(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((file, index) => file === right[index])
}
