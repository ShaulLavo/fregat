import * as v from 'valibot'
import type { GitFileDiff } from '@workspace/contracts'
import { DEMO_ROOT } from '../seed'
import { DemoWorkspace, demoError } from '../state/workspace'
import { fileDiff } from '../utils/git-diff'
import { jsonResponse as json } from '../utils/response'

export async function demoGitRequest(
  url: URL,
  request: Request,
  workspace: DemoWorkspace,
): Promise<Response> {
  if (request.method === 'GET') return get(url, workspace)
  if (request.method === 'POST') return post(url, await request.json(), workspace)
  throw unsupported(url)
}

async function get(url: URL, workspace: DemoWorkspace): Promise<Response> {
  const path = url.searchParams.get('path') || DEMO_ROOT
  const repository = workspace.repository()
  switch (url.pathname) {
    case '/git/repo':
      return json({ repository })
    case '/git/status':
      return json(workspace.gitStatus())
    case '/git/diff': {
      const diffs = workspace.diffs(url.searchParams.get('staged') === 'true')
      return json(
        await Promise.all(diffs.filter((diff) => within(diff.path, path)).map(withObjectIds)),
      )
    }
    case '/git/diff/blob':
      return json(await blobDiff(url, workspace))
    case '/git/file': {
      const ref = url.searchParams.get('ref') ?? 'HEAD'
      const content = revision(workspace, ref).get(workspace.path(path))
      if (content === undefined)
        throw demoError('File does not exist in this revision.', 'NOT_FOUND', 404)
      return json({ path, ref, content })
    }
    case '/git/history/commit':
      return json(await commitDetails(url.searchParams.get('commit') ?? '', workspace))
    case '/git/branches':
      return json({
        repository,
        branches: [
          { name: repository.branch, current: true, commit: repository.commit, upstream: null },
        ],
      })
    case '/git/base-refs':
      return json({
        repository,
        choices: [
          {
            id: repository.branch,
            label: repository.branch,
            local: repository.branch,
            remote: null,
          },
        ],
        defaultChoiceId: repository.branch,
      })
    case '/git/worktrees':
      return json([
        {
          path: DEMO_ROOT,
          absolutePath: DEMO_ROOT,
          branch: repository.branch,
          commit: repository.commit,
          detached: false,
          main: true,
          worktreeId: workspace.worktree.id,
          locked: false,
          prunable: false,
        },
      ])
    case '/git/branch-remote-state':
      return json({ branch: repository.branch, hasUpstream: false, ahead: 0, behind: 0 })
    case '/git/pull-request':
      return json({ branch: repository.branch, pullRequest: null, support: 'no-github-remote' })
    default:
      throw unsupported(url)
  }
}

async function post(url: URL, body: unknown, workspace: DemoWorkspace): Promise<Response> {
  switch (url.pathname) {
    case '/git/stage':
    case '/git/unstage': {
      workspace.stage(
        v.parse(v.object({ paths: v.array(v.string()) }), body).paths,
        url.pathname === '/git/stage',
      )
      return json(workspace.gitStatus())
    }
    case '/git/discard': {
      await workspace.discard(v.parse(v.object({ paths: v.array(v.string()) }), body).paths)
      return json(workspace.gitStatus())
    }
    case '/git/commit':
      return json(workspace.commit(commitMessage(body)))
    case '/git/commit-stream': {
      const result = workspace.commit(commitMessage(body))
      return new Response(
        `event: result\ndata: ${JSON.stringify({ kind: 'result', result })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      )
    }
    case '/git/history':
      return json({
        commits: workspace.history,
        refs: [
          {
            name: workspace.repository().branch,
            kind: 'branch',
            commitId: workspace.repository().commit,
          },
        ],
        next: null,
      })
    case '/git/checkout': {
      const { branch } = v.parse(v.object({ branch: v.string() }), body)
      if (branch !== workspace.repository().branch)
        throw demoError('This demo has one branch. Try staging and committing a change.')
      return json({ repository: workspace.repository(), output: '' })
    }
    default:
      throw unsupported(url)
  }
}

function commitMessage(body: unknown) {
  return v.parse(v.object({ message: v.pipe(v.string(), v.trim(), v.minLength(1)) }), body).message
}

async function withObjectIds(diff: GitFileDiff): Promise<GitFileDiff> {
  return {
    ...diff,
    oldObjectId: diff.oldFileMissing ? undefined : await blobId(diff.oldText ?? ''),
    newObjectId: diff.newFileMissing ? undefined : await blobId(diff.newText ?? ''),
  }
}

async function blobDiff(url: URL, workspace: DemoWorkspace) {
  const path = workspace.path(url.searchParams.get('path') ?? '')
  const before = await blobContent(url.searchParams.get('oldObjectId'), workspace)
  const after = await blobContent(url.searchParams.get('newObjectId'), workspace)
  if (before === undefined && after === undefined) return []
  return [await withObjectIds(fileDiff(path, before, after, false))]
}

async function blobContent(id: string | null, workspace: DemoWorkspace) {
  if (!id) return undefined
  const contents = new Set([...workspace.files.values()].map((file) => file.content))
  for (const snapshot of [workspace.head, workspace.index, ...workspace.revisions.values()]) {
    for (const content of snapshot.values()) contents.add(content)
  }
  for (const content of contents) {
    if ((await blobId(content)) === id) return content
  }
  throw demoError('This file revision is not available in the demo.', 'NOT_FOUND', 404)
}

async function commitDetails(id: string, workspace: DemoWorkspace) {
  const commit = workspace.history.find((candidate) => candidate.id === id)
  if (!commit) throw demoError('This commit is not available in the demo.', 'NOT_FOUND', 404)
  const before = commit.parents[0]
    ? revision(workspace, commit.parents[0])
    : new Map<string, string>()
  const after = revision(workspace, id)
  const paths = [...new Set([...before.keys(), ...after.keys()])].filter(
    (path) => before.get(path) !== after.get(path),
  )
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      status: changeStatus(before.has(path), after.has(path)),
      kind: 'file',
      oldObjectId: before.has(path) ? await blobId(before.get(path)!) : undefined,
      newObjectId: after.has(path) ? await blobId(after.get(path)!) : undefined,
    })),
  )
  return { ...commit, message: commit.subject, files }
}

function revision(workspace: DemoWorkspace, ref: string): ReadonlyMap<string, string> {
  if (ref === 'HEAD' || ref === workspace.repository().branch) return workspace.head
  const snapshot = workspace.revisions.get(ref)
  if (snapshot) return snapshot
  throw demoError('This revision is not available in the demo.', 'NOT_FOUND', 404)
}

async function blobId(content: string) {
  const bytes = new TextEncoder().encode(content)
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`)
  const input = new Uint8Array(header.length + bytes.length)
  input.set(header)
  input.set(bytes, header.length)
  const hash = await crypto.subtle.digest('SHA-1', input)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function changeStatus(before: boolean, after: boolean) {
  if (!before) return 'added'
  if (!after) return 'deleted'
  return 'modified'
}

function within(candidate: string, path: string) {
  return candidate === path || candidate.startsWith(`${path.replace(/\/$/, '')}/`)
}

function unsupported(url: URL) {
  return demoError(
    `This browser demo supports Git status, diffs, staging, commits and history. ${url.pathname} is unavailable.`,
    'DEMO_ROUTE',
    501,
  )
}
