import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../../../../web/test/fixtures'
import type { TestServer } from '../../../../web/test/server'
import { gitBlobRepository } from '../../../test/factories/git-blobs'
import { runGit } from '../../testing/git'
import type { GitBlobDiffQuery } from '../contracts'

const captures = [
  { name: 'existing empty pair', oldPresent: true, newPresent: true, renamed: false },
  { name: 'root-added empty blob', oldPresent: false, newPresent: true, renamed: false },
  { name: 'deleted empty blob', oldPresent: true, newPresent: false, renamed: false },
  { name: 'renamed empty blob', oldPresent: true, newPresent: true, renamed: true },
]

for (const capture of captures) {
  test(`blob reader retains complete text for ${capture.name}`, async ({ server }) => {
    const repo = await gitBlobRepository(server.root)
    const object = await runGit(repo.directory, ['cat-file', '-p', repo.emptyObjectId])
    const size = await runGit(repo.directory, ['cat-file', '-s', repo.emptyObjectId])
    expect(object.exitCode).toBe(0)
    expect(object.stdout).toBe('')
    expect(size.stdout.trim()).toBe('0')
    expect((await runGit(repo.directory, ['log', '-1', '--format=%P'])).stdout.trim()).toBe('')
    if (capture.renamed) {
      await runGit(repo.directory, ['mv', 'empty.txt', 'renamed.txt'])
      await runGit(repo.directory, ['commit', '-m', 'rename empty'])
    }
    const query = {
      path: capture.renamed ? 'blob-repo/renamed.txt' : 'blob-repo/empty.txt',
      oldPath: capture.renamed ? 'blob-repo/empty.txt' : undefined,
      oldObjectId: capture.oldPresent ? repo.emptyObjectId : undefined,
      newObjectId: capture.newPresent ? repo.emptyObjectId : undefined,
    }

    const response = await blobDiff(server, query)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      {
        hunks: [],
        patch: '',
        path: query.path,
        staged: false,
        oldText: object.stdout,
        newText: object.stdout,
        ...(query.oldObjectId ? { oldObjectId: query.oldObjectId } : { oldFileMissing: true }),
        ...(query.newObjectId ? { newObjectId: query.newObjectId } : { newFileMissing: true }),
        ...(query.oldPath ? { oldPath: query.oldPath } : {}),
      },
    ])
  })
}

test('blob reader retains unchanged nonempty text', async ({ server }) => {
  const repo = await gitBlobRepository(server.root)
  const object = await runGit(repo.directory, ['cat-file', '-p', repo.controlObjectId])
  const response = await blobDiff(server, {
    path: 'blob-repo/control.txt',
    oldObjectId: repo.controlObjectId,
    newObjectId: repo.controlObjectId,
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([
    {
      hunks: [],
      patch: '',
      path: 'blob-repo/control.txt',
      staged: false,
      oldObjectId: repo.controlObjectId,
      newObjectId: repo.controlObjectId,
      oldText: object.stdout,
      newText: object.stdout,
    },
  ])
})

test('blob reader keeps absent object IDs unavailable', async ({ server }) => {
  await gitBlobRepository(server.root)
  const response = await blobDiff(server, { path: 'blob-repo/empty.txt' })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([])
})

test('blob reader fails an unavailable object without manufacturing text', async ({ server }) => {
  const repo = await gitBlobRepository(server.root)
  const objectId = '0123456789abcdef0123456789abcdef01234567'
  const object = await runGit(repo.directory, ['cat-file', '-p', objectId], {
    allowFailure: true,
  })
  expect(object.exitCode).not.toBe(0)
  const response = await blobDiff(server, {
    path: 'blob-repo/empty.txt',
    oldObjectId: objectId,
    newObjectId: objectId,
  })

  expect(response.status).toBe(500)
  expect(await response.json()).toMatchObject({ error: { code: 'GIT_COMMAND_FAILED' } })
})

test('blob reader keeps unchanged binary content unavailable as text', async ({ server }) => {
  const repo = await gitBlobRepository(server.root)
  await writeFile(path.join(repo.directory, 'binary.bin'), 'before\0after')
  const objectId = (await runGit(repo.directory, ['hash-object', '-w', 'binary.bin'])).stdout.trim()
  const object = await runGit(repo.directory, ['cat-file', '-p', objectId])
  expect(object.stdout).toContain('\0')
  const response = await blobDiff(server, {
    path: 'blob-repo/binary.bin',
    oldObjectId: objectId,
    newObjectId: objectId,
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([])
})

test('blob reader keeps oversized unchanged content omitted', async ({ server }) => {
  const repo = await gitBlobRepository(server.root)
  await mkdir(path.join(server.root, '.platform-test'), { recursive: true })
  await writeFile(
    path.join(server.root, '.platform-test', 'settings.json'),
    JSON.stringify({ 'git.maxDiffFileSizeMiB': 1 }),
  )
  await server.restart()
  await writeFile(path.join(repo.directory, 'large.txt'), 'x'.repeat(1024 * 1024 + 1))
  const objectId = (await runGit(repo.directory, ['hash-object', '-w', 'large.txt'])).stdout.trim()
  const size = await runGit(repo.directory, ['cat-file', '-s', objectId])
  expect(Number(size.stdout.trim())).toBeGreaterThan(1024 * 1024)
  const query = { path: 'blob-repo/large.txt', oldObjectId: objectId, newObjectId: objectId }
  const response = await blobDiff(server, query)

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([
    { ...query, hunks: [], patch: '', staged: false, omitted: 'size' },
  ])
})

function blobDiff(server: TestServer, query: GitBlobDiffQuery) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value)
  }
  return server.app.handle(
    new Request(`http://local/git/diff/blob?${params}`, {
      headers: { origin: server.origin },
    }),
  )
}
