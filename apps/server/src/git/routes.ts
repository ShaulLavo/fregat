import { Elysia } from 'elysia'
import type { WorktreeSubmoduleMode } from '@workspace/contracts'
import {
  gitApplyPatchBodySchema,
  gitBlobDiffQuerySchema,
  gitBranchDiffQuerySchema,
  gitCheckoutBodySchema,
  gitCloneBodySchema,
  gitPublishBodySchema,
  gitCommitBodySchema,
  gitCommitMessageResultSchema,
  gitCreateBranchBodySchema,
  gitDiffQuerySchema,
  gitFileQuerySchema,
  gitCreatePullRequestBodySchema,
  gitPathBodySchema,
  gitPathQuerySchema,
  gitStatusQuerySchema,
  gitPathsBodySchema,
  gitHistoryBodySchema,
  gitHistoryCommitQuerySchema,
} from './contracts'
import type { CommitMessageGenerator } from './commit-message-generator'
import { sseResponse, toSse } from '../sse'
import type { GitService } from './service'
import { GitWorktreeService } from './worktrees'
import { GitHistory } from './history'

export function gitRoutes(
  git: GitService,
  commitMessages: CommitMessageGenerator,
  options: {
    resolveBaseCommit?: (path: string) => Promise<string | null>
    refreshMetadata?: (path: string) => Promise<void>
    submoduleMode?: (path: string) => Promise<WorktreeSubmoduleMode>
    /** Registers a finished clone as a project; returns its id. */
    registerClone?: (absolutePath: string) => Promise<string | null>
  } = {},
) {
  const worktrees = new GitWorktreeService(git)
  const history = new GitHistory(git)

  return new Elysia({ name: 'git-routes' }).group('/git', (app) =>
    app
      .post('/history', ({ body }) => history.page(body), { body: gitHistoryBodySchema })
      .get('/history/commit', ({ query }) => history.commit(query), {
        query: gitHistoryCommitQuerySchema,
      })
      .get('/repo', ({ query }) => git.repo(query.path), {
        query: gitPathQuerySchema,
      })
      .get(
        '/status',
        async ({ query }) => {
          await options.refreshMetadata?.(query.path)
          return git.status(query.path, query.fresh)
        },
        {
          query: gitStatusQuerySchema,
        },
      )
      .get('/diff/blob', ({ query }) => git.diffBlob(query), {
        query: gitBlobDiffQuerySchema,
      })
      .get('/diff', ({ query }) => git.diff(query.path, query.staged), {
        query: gitDiffQuerySchema,
      })
      .get('/file', ({ query }) => git.file(query.path, query.ref), {
        query: gitFileQuerySchema,
      })
      .get('/branches', ({ query }) => git.branches(query.path), {
        query: gitPathQuerySchema,
      })
      .get('/base-refs', ({ query }) => worktrees.baseRefs(query.path), {
        query: gitPathQuerySchema,
      })
      .get(
        '/branch-diff',
        async ({ query }) =>
          worktrees.branchDiff({
            ...query,
            baseCommit: (await options.resolveBaseCommit?.(query.path)) ?? undefined,
          }),
        {
          query: gitBranchDiffQuerySchema,
        },
      )
      .get('/worktrees', ({ query }) => worktrees.list(query.path), {
        query: gitPathQuerySchema,
      })
      .post('/stage', ({ body }) => git.stage(body), {
        body: gitPathsBodySchema,
      })
      .post('/unstage', ({ body }) => git.unstage(body), {
        body: gitPathsBodySchema,
      })
      .post('/discard', ({ body }) => git.discard(body), {
        body: gitPathsBodySchema,
      })
      .post('/apply-patch', ({ body }) => git.applyPatch(body), {
        body: gitApplyPatchBodySchema,
      })
      .post('/commit', ({ body }) => git.commit(body), {
        body: gitCommitBodySchema,
      })
      .post(
        '/commit-message',
        ({ body, request }) => commitMessages.generate(body.path, request.signal),
        {
          body: gitPathBodySchema,
          response: gitCommitMessageResultSchema,
        },
      )
      // Streamed rather than awaited: a commit runs the repository's hooks, and
      // a slow hook is only distinguishable from a stuck one if its output
      // arrives while it is still running.
      .post(
        '/commit-stream',
        ({ body, request }) =>
          sseResponse(
            toSse(git.commitProgress(body), {
              event: (event) => event.kind,
            }),
            request.signal,
          ),
        {
          body: gitCommitBodySchema,
        },
      )
      .post('/checkout', ({ body }) => git.checkout(body), {
        body: gitCheckoutBodySchema,
      })
      .post('/create-branch', ({ body }) => git.createBranch(body), {
        body: gitCreateBranchBodySchema,
      })
      .post('/fetch', ({ body }) => git.fetch(body.path), {
        body: gitPathBodySchema,
      })
      // An explicit request: `none` only stops automatic initialization.
      .post(
        '/submodules/init',
        async ({ body }) => {
          const mode = (await options.submoduleMode?.(body.path)) ?? 'recursive'
          return git.initializeSubmodules(body.path, mode === 'none' ? 'top-level' : mode)
        },
        { body: gitPathBodySchema },
      )
      // Streamed, so a large transfer shows its progress; closing the stream cancels the clone.
      .post(
        '/clone-stream',
        ({ body, request }) =>
          sseResponse(
            toSse(git.cloneProgress(body, options.registerClone ?? (async () => null)), {
              event: (event) => event.kind,
            }),
            request.signal,
          ),
        { body: gitCloneBodySchema },
      )
      .post('/publish', ({ body }) => git.publish(body), { body: gitPublishBodySchema })
      .post('/pull', ({ body }) => git.pull(body.path), {
        body: gitPathBodySchema,
      })
      .post('/push', ({ body }) => git.push(body.path), {
        body: gitPathBodySchema,
      })
      .get('/branch-remote-state', ({ query }) => git.branchRemoteState(query.path), {
        query: gitPathQuerySchema,
      })
      .get('/pull-request', ({ query }) => git.pullRequestState(query.path), {
        query: gitPathQuerySchema,
      })
      .post('/pull-request', ({ body }) => git.createPullRequest(body), {
        body: gitCreatePullRequestBodySchema,
      })
      .post('/push-and-pull-request', ({ body }) => git.pushAndOpenPullRequest(body), {
        body: gitCreatePullRequestBodySchema,
      }),
  )
}
