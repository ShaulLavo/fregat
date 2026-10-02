import type { WatchServerMessage } from '@workspace/contracts'
import { isObject } from '@workspace/utils/objects'
import type { Client } from '@/lib/client'
import { streamWorkspaceEvents } from '@/features/workspace/state/event-stream'
import { log } from '@/lib/client-logging'
import { clientErrors } from '@/lib/structured-errors'

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
  let stoppedFiles: {
    readonly files: readonly string[]
    readonly reason: 'exhausted' | 'rejected'
  } | null = null
  let projectState: 'active' | 'exhausted' | 'rejected' = 'active'
  let desiredFiles: readonly string[] = []
  let reportedTransportFailure = false
  const failures = { project: 0, files: 0 }

  void runProjectStream()

  function recordFailure(scope: StreamInterruption['scope'], error: unknown) {
    const count = ++failures[scope]
    if (count === 1) {
      log.warn({
        action: 'workspace.events.reconnecting',
        area: 'workspace-events',
        path: rootPath,
        scope,
        status: responseStatus(error),
      })
    }
    // Use the existing backoff steps before surfacing a transport outage to the user.
    return count >= RECONNECT_DELAYS_MS.length
  }

  function finishFailureSeries(
    scope: StreamInterruption['scope'],
    outcome: 'recovered' | 'gave_up' | 'rejected' | 'cancelled' = 'recovered',
  ) {
    const failedAttemptCount = failures[scope]
    if (failedAttemptCount === 0) return
    failures[scope] = 0
    log.info({
      action: `workspace.events.${outcome}`,
      area: 'workspace-events',
      path: rootPath,
      scope,
      failedAttemptCount,
    })
  }

  async function runProjectStream() {
    let attempt = 0
    while (!project.signal.aborted) {
      const stream = new AbortController()
      const stop = () => stream.abort()
      project.signal.addEventListener('abort', stop)
      const error = await streamWorkspaceEvents(client, rootPath, stream.signal, (message) => {
        if (project.signal.aborted) return
        if (message.type === 'ready') {
          attempt = 0
          finishFailureSeries('project')
        }
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
      if (isFinalRejection(failure)) {
        projectState = 'rejected'
        finishFailureSeries('project', 'rejected')
        onError(failure)
        return
      }
      const exhausted = recordFailure('project', failure)
      const retryInMs = exhausted ? 0 : reconnectDelay(attempt++)
      onInterrupted({ scope: 'project', error: failure, retryInMs })
      if (exhausted) {
        projectState = 'exhausted'
        finishFailureSeries('project', 'gave_up')
        reportTransportFailure('project', failure)
        return
      }
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
    finishFailureSeries('files')
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
    const exhausted = recordFailure('files', error)
    const retryInMs = exhausted ? 0 : reconnectDelay(filesAttempt++)
    onInterrupted({ scope: 'files', error, retryInMs })
    cancelFilesRetry()
    if (exhausted) {
      stoppedFiles = { files: stream.files, reason: 'exhausted' }
      finishFailureSeries('files', 'gave_up')
      reportTransportFailure('files', error)
      return
    }
    filesRetry = setTimeout(() => {
      filesRetry = null
      // A rejected or exhausted subscription waits for its owner to re-arm it.
      if (!current && !pending && !stoppedFiles) setFiles(stream.files)
    }, retryInMs)
  }

  /** The server refused this exact set; asking again gets the same answer until the set changes. */
  function rejectFiles(stream: FileStream, error: unknown) {
    if (stream !== current && stream !== pending) return
    stream.controller.abort()
    if (stream === current) current = null
    if (stream === pending) pending = null
    stoppedFiles = { files: stream.files, reason: 'rejected' }
    finishFailureSeries('files', 'rejected')
    log.warn({
      action: 'workspace.events.files_rejected',
      area: 'workspace-events',
      fileCount: stream.files.length,
      path: rootPath,
      retryCount: filesAttempt,
      status: responseStatus(error),
    })
    filesAttempt = 0
    onError(error)
  }

  function setFiles(paths: readonly string[]) {
    if (project.signal.aborted) return
    const files = [...new Set(paths)].sort()
    if (!sameFiles(desiredFiles, files)) {
      finishFailureSeries('files', 'cancelled')
      filesAttempt = 0
      desiredFiles = files
      if (projectState !== 'exhausted') reportedTransportFailure = false
    }
    const desired = pending ?? current
    if (desired && sameFiles(desired.files, files)) return
    // A retry scheduled for an earlier set would resubscribe files no tab holds any more.
    cancelFilesRetry()
    if (stoppedFiles && sameFiles(stoppedFiles.files, files)) return
    stoppedFiles = null
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
        if (isFinalRejection(error)) {
          rejectFiles(stream, error)
          return
        }
        interruptFiles(stream, error)
      },
    )
  }

  function reportTransportFailure(scope: StreamInterruption['scope'], error: unknown) {
    if (reportedTransportFailure) return
    reportedTransportFailure = true
    onError(
      clientErrors.WATCH_FAILED({
        status: responseStatus(error),
        internal: {
          scope,
          failedAttemptCount: RECONNECT_DELAYS_MS.length,
          httpStatus: responseStatus(error),
        },
      }),
    )
  }

  function cancelFilesRetry() {
    if (filesRetry) clearTimeout(filesRetry)
    filesRetry = null
  }

  return {
    setFiles,
    resume() {
      if (project.signal.aborted) return
      if (projectState === 'exhausted' || stoppedFiles?.reason === 'exhausted') {
        reportedTransportFailure = false
      }
      if (projectState === 'exhausted') {
        projectState = 'active'
        void runProjectStream()
      }
      if (stoppedFiles?.reason !== 'exhausted') return
      stoppedFiles = null
      filesAttempt = 0
      setFiles(desiredFiles)
    },
    close() {
      project.abort()
      finishFailureSeries('project', 'cancelled')
      finishFailureSeries('files', 'cancelled')
      pending?.controller.abort()
      current?.controller.abort()
      cancelFilesRetry()
      pending = null
      current = null
    },
  }
}

function responseStatus(error: unknown) {
  if (!isObject(error) || typeof error.status !== 'number') return undefined
  return error.status
}

function isFinalRejection(error: unknown) {
  const status = responseStatus(error)
  return status !== undefined && status >= 400 && status < 500
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
