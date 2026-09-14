import { expect, test } from '../../../test/fixtures'
import { DemoWorkspace } from '../state/workspace'
import { demoGitRequest } from '../transport/git'
import { DEMO_TIME } from '../seed'

function request(workspace: DemoWorkspace, path: string, body?: unknown) {
  const url = new URL(path, 'https://fregat-demo.invalid')
  const input =
    body === undefined
      ? new Request(url)
      : new Request(url, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        })
  return demoGitRequest(url, input, workspace)
}

test('staging and unstaging return the status shape the Git client consumes', async () => {
  const workspace = await DemoWorkspace.create()
  const staged = await request(workspace, '/git/stage', { paths: ['notes/autumn.md'] })
  expect(await staged.json()).toMatchObject({
    files: [{ index: 'modified', worktree: 'unmodified' }],
  })
  const unstaged = await request(workspace, '/git/unstage', { paths: ['notes/autumn.md'] })
  expect(await unstaged.json()).toMatchObject({
    files: [{ index: 'unmodified', worktree: 'modified' }],
  })
})

test('the commit stream publishes a result and history retains its exact file contents', async () => {
  const workspace = await DemoWorkspace.create()
  const original = workspace.head.get('/garden/notes/autumn.md')
  const previousCommit = workspace.history[0]!.id
  await request(workspace, '/git/stage', { paths: ['notes/autumn.md'] })
  const response = await request(workspace, '/git/commit-stream', { message: 'Mulch the garden' })
  expect(response.headers.get('content-type')).toBe('text/event-stream')
  const frame = await response.text()
  expect(frame).toContain('event: result\n')
  expect(JSON.parse(frame.split('data: ')[1]!.trim())).toMatchObject({
    kind: 'result',
    result: { kind: 'committed' },
  })
  expect(workspace.gitStatus().files).toEqual([])
  const oldFile = await request(
    workspace,
    `/git/file?path=/garden/notes/autumn.md&ref=${previousCommit}`,
  )
  expect(await oldFile.json()).toMatchObject({ content: original })

  const detail = await request(workspace, `/git/history/commit?commit=${workspace.history[0]!.id}`)
  const { files } = await detail.json()
  expect(files).toHaveLength(1)
  const file = files[0]
  const diff = await request(
    workspace,
    `/git/diff/blob?path=${file.path}&oldObjectId=${file.oldObjectId}&newObjectId=${file.newObjectId}`,
  )
  expect(await diff.json()).toMatchObject([
    { oldText: original, newText: workspace.readFile('notes/autumn.md')!.content },
  ])
})

test('unsupported Git operations fail explicitly without changing the workspace', async () => {
  const workspace = await DemoWorkspace.create()
  await expect(
    request(workspace, '/git/apply-patch', { patch: '', path: '/garden' }),
  ).rejects.toMatchObject({ status: 501 })
  expect(workspace.gitStatus().files).toHaveLength(1)
})

test('history uses epoch milliseconds and canonical branch references', async () => {
  const workspace = await DemoWorkspace.create()
  const seeded = await (await request(workspace, '/git/history', {})).json()
  expect(seeded.commits[0].timestamp).toBe(Date.parse(DEMO_TIME))
  expect(seeded.refs).toEqual([
    { name: 'refs/heads/main', kind: 'branch', commitId: seeded.commits[0].id },
  ])

  await request(workspace, '/git/stage', { paths: ['notes/autumn.md'] })
  const before = Date.now()
  await request(workspace, '/git/commit', { message: 'Mulch the garden' })
  const committed = await (await request(workspace, '/git/history', {})).json()
  expect(committed.commits[0].timestamp).toBeGreaterThanOrEqual(before)
  expect(committed.commits[0].timestamp).toBeLessThanOrEqual(Date.now())
  expect(committed.next).toBeNull()
})

test('history filters messages, authors and commit IDs within the selected reference', async () => {
  const workspace = await DemoWorkspace.create()
  await request(workspace, '/git/stage', { paths: ['notes/autumn.md'] })
  await request(workspace, '/git/commit', { message: 'Mulch the garden' })
  const newest = workspace.history[0]!
  for (const search of ['MULCH', 'YOU@EXAMPLE.INVALID', newest.id.slice(0, 8)]) {
    const page = await (
      await request(workspace, '/git/history', { search, ref: 'refs/heads/main' })
    ).json()
    expect(page.commits.map((commit: { id: string }) => commit.id)).toEqual([newest.id])
  }
  const missing = await (
    await request(workspace, '/git/history', { search: 'absent-commit' })
  ).json()
  expect(missing.commits).toEqual([])
  const other = await (await request(workspace, '/git/history', { ref: 'refs/heads/other' })).json()
  expect(other.commits).toEqual([])
  const current = await (await request(workspace, '/git/history', { ref: 'HEAD' })).json()
  expect(current.commits).toHaveLength(2)
  await expect(
    request(workspace, '/git/history', { cursor: { tips: [newest.id], skip: -1 } }),
  ).rejects.toThrow()
})
