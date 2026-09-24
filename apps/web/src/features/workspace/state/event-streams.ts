import type { WatchServerMessage } from '@workspace/contracts'
import type { Client } from '@/lib/client'
import { streamWorkspaceEvents } from '@/features/workspace/state/event-stream'

type FileStream = {
  readonly controller: AbortController
  readonly files: readonly string[]
}

export type StreamInterruption = {
  readonly scope: 'project' | 'files'
  /** Absent when the server ended the stream cleanly, as it does on shutdown. */
  readonly error?: unknown
  readonly retryInMs: number
}

// A new stream is a new generation: its `ready` resynchronizes everything the gap could hide.
const RECONNECT_DELAYS_MS = [250, 1000, 2000, 5000, 10_000] as const

export function startWorkspaceEventStreams({
  client,
  rootPath,
  onMessage,
  onFilesReady,
  onError,
  onInterrupted,
}: {
  client: Client
  rootPath: string
  onMessage: (message: WatchServerMessage) => void
  onFilesReady: (files: readonly string[]) => void
  onError: (error: unknown) => void
  onInterrupted: (interruption: StreamInterruption) => void
}) {
  const project = new AbortController()
  let current: FileStream | null = null
  let pending: FileStream | null = null
  let filesAttempt = 0
  let filesRetry: ReturnType<typeof setTimeout> | null = null

  void runProjectStream()

  async function runProjectStream() {
    let attempt = 0
    while (!project.signal.aborted) {
      const stream = new AbortController()
      const stop = () => stream.abort()
      project.signal.addEventListener('abort', stop)
      const error = await streamWorkspaceEvents(client, rootPath, stream.signal, (message) => {
        if (project.signal.aborted) return
        if (message.type === 'ready') attempt = 0
        onMessage(message)
        // A failed watch may have dropped events; only a fresh subscription can say what changed.
        if (message.type === 'error') stream.abort()
      }).then(
        () => undefined,
        (cause: unknown) => cause,
      )
      project.signal.removeEventListener('abort', stop)
      if (project.signal.aborted) return
      const failure = stream.signal.aborted ? undefined : error
      // One report per outage: the retries that follow are counted, not toasted.
      if (failure !== undefined && attempt === 0) onError(failure)
      const retryInMs = reconnectDelay(attempt++)
      onInterrupted({ scope: 'project', error: failure, retryInMs })
      await sleep(retryInMs, project.signal)
    }
  }

  function receive(stream: FileStream, message: WatchServerMessage) {
    if (stream.controller.signal.aborted || project.signal.aborted) return
    if (message.type === 'error') {
      onMessage(message)
      interruptFiles(stream)
      return
    }
    if (message.type !== 'ready') {
      onMessage(message)
      return
    }
    if (pending !== stream) return
    filesAttempt = 0
    const previousFiles = new Set(current?.files)
    const added = stream.files.filter((file) => !previousFiles.has(file))
    // The old stream covers retained files until its replacement has attached every watch.
    current?.controller.abort()
    current = stream
    pending = null
    if (added.length > 0) onFilesReady(added)
  }

  /** Reopens a files stream that ended on its own; its replacement re-reads every file. */
  function interruptFiles(stream: FileStream, error?: unknown) {
    if (stream !== current && stream !== pending) return
    stream.controller.abort()
    if (stream === current) current = null
    if (stream === pending) pending = null
    const retryInMs = reconnectDelay(filesAttempt++)
    onInterrupted({ scope: 'files', error, retryInMs })
    if (filesRetry) clearTimeout(filesRetry)
    filesRetry = setTimeout(() => {
      filesRetry = null
      if (!current && !pending) setFiles(stream.files)
    }, retryInMs)
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
    ).then(
      () => {
        if (!stream.controller.signal.aborted) interruptFiles(stream)
      },
      (error: unknown) => {
        if (stream.controller.signal.aborted) return
        if (filesAttempt === 0) onError(error)
        interruptFiles(stream, error)
      },
    )
  }

  return {
    setFiles,
    close() {
      project.abort()
      pending?.controller.abort()
      current?.controller.abort()
      if (filesRetry) clearTimeout(filesRetry)
      filesRetry = null
      pending = null
      current = null
    },
  }
}

function reconnectDelay(attempt: number) {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 10_000
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
    function finish() {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
  })
}

function sameFiles(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((file, index) => file === right[index])
}
