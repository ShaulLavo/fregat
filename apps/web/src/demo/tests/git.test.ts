import { expect, test } from '../../../test/fixtures'
import { DemoWorkspace } from '../state/workspace'
import { demoGitRequest } from '../transport/git'

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
