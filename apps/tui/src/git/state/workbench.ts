import type { Client } from '@workspace/client-core/transport/client'
import { requireEdenData } from '@workspace/client-core/transport/eden'
import { readGitCommitStream } from '@workspace/client-core/git/commit-stream'
import { pullRequestMessage } from '@/git/utils/actions'
import { readDiffFiles } from '@/git/state/diff'
import type { GitStatusResult } from '@workspace/contracts'
import type { DiffFile } from '@singapore-editor/diff'
import { connectionFailure } from '@/connection/utils/failure'
import { createTuiError } from '@/host/utils/structured-errors'

type Listing =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; data: GitStatusResult }
type Diff =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; files: readonly DiffFile[] }
type State = { listing: Listing; diff: Diff; busy: boolean; message: string; progress: string }

export function createGitWorkbench(client: Client, rootPath: string) {
  const listeners = new Set<() => void>()
  const lifetime = new AbortController()
  let statusRequest = new AbortController()
  let diffRequest = new AbortController()
  let state: State = {
    listing: { kind: 'loading' },
    diff: { kind: 'empty' },
    busy: false,
    message: '',
    progress: '',
  }
  function publish(next: State) {
    if (lifetime.signal.aborted) return
    state = next
    for (const listener of listeners) listener()
  }
  async function refresh() {
    if (lifetime.signal.aborted) return
    statusRequest.abort()
    diffRequest.abort()
    const controller = new AbortController()
    statusRequest = controller
    const signal = AbortSignal.any([lifetime.signal, controller.signal])
    publish({ ...state, listing: { kind: 'loading' }, diff: { kind: 'empty' } })
    try {
      const data = requireEdenData(
        await client.git.status.get({ query: { path: rootPath }, fetch: { signal } }),
      )
      if (!signal.aborted) publish({ ...state, listing: { kind: 'ready', data } })
    } catch (error) {
      if (!signal.aborted)
        publish({
          ...state,
          listing: { kind: 'failed', message: connectionFailure(error).message },
        })
    }
  }
  async function openDiff(path: string, staged: boolean) {
    if (lifetime.signal.aborted) return
    diffRequest.abort()
    const controller = new AbortController()
    diffRequest = controller
    const signal = AbortSignal.any([lifetime.signal, controller.signal])
    publish({ ...state, diff: { kind: 'loading' } })
    try {
      const files = await readDiffFiles(client, path, staged, signal)
      if (!signal.aborted) publish({ ...state, diff: { kind: 'ready', files } })
    } catch (error) {
      if (!signal.aborted)
        publish({ ...state, diff: { kind: 'failed', message: connectionFailure(error).message } })
    }
  }
  async function mutate(action: () => Promise<unknown>, message: string | (() => string)) {
    if (state.busy || lifetime.signal.aborted) return false
    diffRequest.abort()
    publish({ ...state, busy: true, message: '', progress: '', diff: { kind: 'empty' } })
    try {
      await action()
      publish({
        ...state,
        busy: false,
        message: typeof message === 'function' ? message() : message,
        diff: { kind: 'empty' },
      })
      await refresh()
      return true
    } catch (error) {
      publish({ ...state, busy: false, message: connectionFailure(error).message })
      await refresh()
      return false
    }
  }
  async function commit(message: string) {
    if (!message.trim()) return false
    return mutate(async () => {
      const stream = requireEdenData(
        await client.git['commit-stream'].post(
          { path: rootPath, message, source: 'input' },
          { fetch: { signal: lifetime.signal } },
        ),
      )
      const outcome = await readGitCommitStream(stream, (line) => {
        // 8000 chars is a display budget for the progress pane, not a transport limit.
        publish({ ...state, progress: `${state.progress}${line.text}\n`.slice(-8000) })
      })
      if (outcome.kind === 'failed')
        throw createTuiError(
          outcome.message,
          'Read the hook output, correct the reported problem, and commit again.',
        )
      if (outcome.kind === 'ended-without-result')
        throw createTuiError(
          'Commit ended before reporting a result.',
          'Refresh Git status before retrying the commit.',
        )
    }, 'Committed staged changes.')
  }
  async function generateMessage() {
    if (state.busy || lifetime.signal.aborted) return null
    publish({ ...state, busy: true, message: '' })
    try {
      const result = requireEdenData(
        await client.git['commit-message'].post(
          { path: rootPath },
          { fetch: { signal: lifetime.signal } },
        ),
      )
      publish({ ...state, busy: false })
      return result.message
    } catch (error) {
      publish({ ...state, busy: false, message: connectionFailure(error).message })
      return null
    }
  }
  async function createPullRequest(title: string) {
    if (!title.trim()) return false
    let message = ''
    return mutate(
      async () => {
        const result = requireEdenData(
          await client.git['pull-request'].post(
            { path: rootPath, title, body: '', draft: true },
            { fetch: { signal: lifetime.signal } },
          ),
        )
        message = pullRequestMessage(result)
      },
      () => message,
    )
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => state,
    refresh,
    openDiff,
    commit,
    generateMessage,
    createPullRequest,
    stage: (path: string) =>
      mutate(
        async () => requireEdenData(await client.git.stage.post({ paths: [path] })),
        'Staged file.',
      ),
    unstage: (path: string) =>
      mutate(
        async () => requireEdenData(await client.git.unstage.post({ paths: [path] })),
        'Unstaged file.',
      ),
    discard: (path: string) =>
      mutate(
        async () => requireEdenData(await client.git.discard.post({ paths: [path] })),
        'Discarded file changes.',
      ),
    fetch: () =>
      mutate(
        async () => requireEdenData(await client.git.fetch.post({ path: rootPath })),
        'Fetched remote changes.',
      ),
    pull: () =>
      mutate(
        async () => requireEdenData(await client.git.pull.post({ path: rootPath })),
        'Pulled remote changes.',
      ),
    push: () =>
      mutate(
        async () => requireEdenData(await client.git.push.post({ path: rootPath })),
        'Pushed commits.',
      ),
    dispose() {
      lifetime.abort()
      statusRequest.abort()
      diffRequest.abort()
      listeners.clear()
    },
  }
}
