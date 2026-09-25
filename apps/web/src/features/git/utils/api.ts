import type { GitStatusResult } from '@workspace/contracts'
import { clientLogContext } from '@/lib/environments/state/log-context'
import type {
  GitBranchRemoteState,
  GitCommitResult,
  GitPullRequestCreateResult,
  GitPullRequestState,
} from '@workspace/contracts'

import type { Client } from '@/lib/client'
import { observeClientOperation } from '@/lib/client-logging'
import { readGitCommitStream } from '@workspace/client-core/git/commit-stream'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { createClientError } from '@workspace/client-core/errors'

/**
 * A hook rejecting a commit is an expected outcome, not a transport fault — the
 * lines already relayed say why, so the error only has to carry the verdict.
 */
function createGitCommitFailure(message: string) {
  return createClientError({
    code: 'GIT_COMMIT_REJECTED',
    message,
    status: 409,
    why: 'git commit exited non-zero, which for a repository with hooks usually means a hook refused the commit.',
    fix: 'Read the hook output shown with the commit, fix what it reported, and commit again.',
  })
}

/**
 * Reads a file as of a git ref. Unlike the diff endpoints this returns plain content with no
 * version or mtime, so the result can only back a read-only buffer, never a saveable document.
 */
export async function fetchGitFile(
  path: string,
  ref: string,
  signal: AbortSignal | undefined,
  client: Client,
) {
  return observeGitOperation(
    { ...clientLogContext(client), action: 'git.file', path, signal },
    async () => {
      const response = await client.git.file.get({
        fetch: { signal },
        query: { path, ref },
      })

      return unwrapGit(response)
    },
    (result) => ({ length: result.content.length }),
  )
}

export async function fetchStatus(
  path: string,
  signal: AbortSignal | undefined,
  client: Client,
  fresh = false,
) {
  return observeGitOperation(
    { ...clientLogContext(client), action: 'git.status', path, signal },
    async () => {
      const response = await client.git.status.get({
        query: { path, fresh },
        fetch: { signal },
      })

      return unwrapGit(response)
    },
    (result) => ({ fileCount: result.files.length, hasRepository: result.repository !== null }),
  )
}

export async function fetchDiff(
  path: string,
  staged: boolean,
  signal: AbortSignal | undefined,
  client: Client,
) {
  return observeGitOperation(
    { ...clientLogContext(client), action: 'git.diff', path, signal, staged },
    async () => {
      const response = await client.git.diff.get({
        query: { path, staged },
        fetch: { signal },
      })

      return unwrapGit(response)
    },
    (diffs) => ({ diffCount: diffs.length }),
  )
}

export async function generateCommitMessage(path: string, signal: AbortSignal, client: Client) {
  return observeGitOperation(
    { ...clientLogContext(client), action: 'git.generate_commit_message', path, signal },
    async () => {
      const response = await client.git['commit-message'].post({ path }, { fetch: { signal } })

      return unwrapGit(response)
    },
    (result) => ({
      model: result.modelSelection.model,
      providerInstanceId: result.modelSelection.providerInstanceId,
      source: result.source,
    }),
  )
}

export async function stagePath(path: string, client: Client) {
  return stagePaths([path], client)
}

export async function stagePaths(paths: readonly string[], client: Client) {
  return observeGitPathsOperation(client, 'git.stage', paths, async () => {
    const response = await client.git.stage.post({ paths: Array.from(paths) })

    return unwrapGit(response)
  })
}

export async function unstagePath(path: string, client: Client) {
  return unstagePaths([path], client)
}

export async function unstagePaths(paths: readonly string[], client: Client) {
  return observeGitPathsOperation(client, 'git.unstage', paths, async () => {
    const response = await client.git.unstage.post({ paths: Array.from(paths) })

    return unwrapGit(response)
  })
}

export async function discardPaths(paths: readonly string[], client: Client) {
  return observeGitPathsOperation(client, 'git.discard', paths, async () => {
    const response = await client.git.discard.post({ paths: Array.from(paths) })

    return unwrapGit(response)
  })
}

/**
 * Commits with the hooks' output relayed as it happens.
 *
 * A commit runs the repository's hooks, and a forty-second pre-commit hook is
 * indistinguishable from a wedged one while the only signal is a button that
 * has not come back. `onProgress` is called per line so the caller can show the
 * hook talking; the resolved value is the same commit result the one-shot route
 * returns.
 */
/** `message-file` commits what was written in COMMIT_EDITMSG; `message` is then unused. */
export type CommitRequest = {
  readonly message: string
  readonly source: 'input' | 'message-file'
}

export async function commitChangesStreaming(
  path: string,
  { message, source }: CommitRequest,
  onProgress: (line: { stream: 'stderr' | 'stdout'; text: string }) => void,
  client: Client,
): Promise<GitCommitResult> {
  return observeGitOperation(
    {
      ...clientLogContext(client),
      action: 'git.commit_stream',
      commitSource: source,
      messageBytes: new Blob([message]).size,
      path,
    },
    async () => {
      const response = await client.git['commit-stream'].post({ message, path, source })
      const stream = unwrapGit(response)

      return readCommitProgress(stream, onProgress)
    },
    (result) => ({ kind: result.kind }),
  )
}

/**
 * A `failed` frame is the hook rejecting the commit — an ordinary outcome the
 * server cannot report as a status code, because the response body has already
 * begun by the time a hook runs.
 */
async function readCommitProgress(
  stream: unknown,
  onProgress: (line: { stream: 'stderr' | 'stdout'; text: string }) => void,
): Promise<GitCommitResult> {
  const outcome = await readGitCommitStream(stream, onProgress)
  if (outcome.kind === 'failed') throw createGitCommitFailure(outcome.message)
  if (outcome.kind === 'ended-without-result')
    throw createGitCommitFailure('git commit ended without reporting a result')

  return outcome.result
}

export async function fetchRemote(path: string, client: Client) {
  return observeGitOperation(
    { ...clientLogContext(client), action: 'git.fetch_remote', path },
    async () => {
      const response = await client.git.fetch.post({ path })

      return unwrapGit(response)
    },
    outputSummary,
  )
}

export async function pullRemote(path: string, client: Client) {
  return observeGitOperation(
    { ...clientLogContext(client), action: 'git.pull_remote', path },
    async () => {
      const response = await client.git.pull.post({ path })

      return unwrapGit(response)
    },
    outputSummary,
  )
}

export async function pushRemote(path: string, client: Client) {
  return observeGitOperation(
    { ...clientLogContext(client), action: 'git.push_remote', path },
    async () => {
      const response = await client.git.push.post({ path })

      return unwrapGit(response)
    },
    outputSummary,
  )
}

export async function fetchBranchRemoteState(
  path: string,
  signal: AbortSignal | undefined,
  client: Client,
) {
  return observeGitOperation(
    { ...clientLogContext(client), action: 'git.branch_remote_state', path, signal },
    async () => {
      const response = await client.git['branch-remote-state'].get({
        fetch: { signal },
        query: { path },
      })

      return unwrapGit<GitBranchRemoteState>(response)
    },
    (state) => ({ ahead: state.ahead, hasUpstream: state.hasUpstream }),
  )
}

export async function fetchPullRequestState(
  path: string,
  signal: AbortSignal | undefined,
  client: Client,
) {
  return observeGitOperation(
    { ...clientLogContext(client), action: 'git.pull_request_state', path, signal },
    async () => {
      const response = await client.git['pull-request'].get({
        fetch: { signal },
        query: { path },
      })

      return unwrapGit<GitPullRequestState>(response)
    },
    (state) => ({ pullRequestNumber: state.pullRequest?.number ?? null, support: state.support }),
  )
}

export async function createPullRequest(
  input: {
    base?: string
    body?: string
    draft?: boolean
    path: string
    title: string
  },
  client: Client,
) {
  return observeGitOperation(
    { ...clientLogContext(client), action: 'git.create_pull_request', path: input.path },
    async () => {
      const response = await client.git['pull-request'].post({
        ...input,
        body: input.body ?? '',
        draft: input.draft ?? false,
      })

      return unwrapGit<GitPullRequestCreateResult>(response)
    },
    (result) => ({ kind: result.kind }),
  )
}

export async function syncRemote(path: string, client: Client) {
  return observeGitOperation(
    { ...clientLogContext(client), action: 'git.sync_remote', path },
    async () => {
      const pull = await pullRemote(path, client)
      const push = await pushRemote(path, client)

      return { pull, push }
    },
  )
}

/** Every git route answers with a body; an empty one is a server fault. */
export function unwrapGit<T>(response: { data?: T | null; error?: unknown }) {
  return unwrapEdenResponse(response, {
    requireData: true,
    emptyMessage: 'git server returned an empty response',
  })
}

function observeGitOperation<T>(
  event: {
    readonly action: string
    readonly signal?: AbortSignal
    readonly [key: string]: unknown
  },
  operation: () => Promise<T>,
  summarize?: (result: T) => Record<string, unknown>,
) {
  return observeClientOperation({ area: 'git', ...event }, operation, summarize)
}

function observeGitPathsOperation(
  client: Client,
  action: string,
  paths: readonly string[],
  operation: () => Promise<GitStatusResult>,
) {
  return observeGitOperation(
    { ...clientLogContext(client), action, path: paths[0] ?? '', pathCount: paths.length },
    operation,
    statusSummary,
  )
}

function statusSummary(result: GitStatusResult) {
  return {
    fileCount: result.files.length,
    hasRepository: result.repository !== null,
  }
}

function outputSummary(result: { output: string }) {
  return {
    outputBytes: new Blob([result.output]).size,
  }
}
