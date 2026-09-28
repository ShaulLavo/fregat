import { rename, symlink, truncate, unlink, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, vi } from 'vitest'
import { test, workspaceRequest } from '../../../test/factories/workspace-address'
import { FileReadSessions } from '../read-sessions'
import { createWorkspacePaths } from '../path'

const signal = () => new AbortController().signal

test('returns bounded byte pages from a file above the text-open cap and disposes idempotently', async ({
  workspace,
}) => {
  const filename = path.join(workspace.root, 'large.txt')
  await writeFile(filename, 'hello')
  await truncate(filename, 300 * 1024 * 1024)
  const app = workspace.openApp()
  const created = await workspaceRequest(app, '/fs/read-session?path=large.txt', {})
  expect(created.status).toBe(200)
  const session = await created.json()
  expect(session.byteLength).toBe(300 * 1024 * 1024)
  const page = await workspaceRequest(app, `/fs/read-session/${session.id}?start=0&end=5`)
  expect(page.status).toBe(200)
  expect(page.headers.get('x-fs-revision')).toBe(session.revision)
  expect(await page.text()).toBe('hello')
  const oversized = await workspaceRequest(
    app,
    `/fs/read-session/${session.id}?start=0&end=${session.maxRangeBytes + 1}`,
  )
  expect(oversized.status).toBe(416)
  for (let index = 0; index < 2; index += 1) {
    const disposed = await app.handle(
      new Request(`http://local/fs/read-session/${session.id}`, {
        method: 'DELETE',
        headers: { origin: 'http://localhost:5173' },
      }),
    )
    expect(disposed.status).toBe(200)
  }
  expect((await workspaceRequest(app, `/fs/read-session/${session.id}?start=0&end=1`)).status).toBe(
    410,
  )
})

test('rejects path escape and unauthenticated creation before retaining a handle', async ({
  workspace,
}) => {
  await writeFile(path.join(workspace.directory, 'outside.txt'), 'outside')
  await symlink('../outside.txt', path.join(workspace.root, 'escape.txt'))
  const app = workspace.openApp()
  expect((await workspaceRequest(app, '/fs/read-session?path=escape.txt', {})).status).toBe(403)
  expect(
    (
      await app.handle(
        new Request('http://local/fs/read-session?path=escape.txt', { method: 'POST' }),
      )
    ).status,
  ).toBe(401)
})

test.for(['edit', 'replace', 'truncate', 'delete', 'symlink'] as const)(
  'invalidates every later range after %s',
  async (change, { workspace }) => {
    const filename = path.join(workspace.root, 'file.txt')
    await writeFile(filename, 'original')
    const sessions = new FileReadSessions(createWorkspacePaths(workspace.root), () => ({
      maxSessions: 2,
      maxRangeBytes: 4,
      idleMs: 60_000,
    }))
    try {
      const session = await sessions.open('file.txt', signal())
      expect(
        new TextDecoder().decode((await sessions.read(session.id, 0, 4, signal())).bytes),
      ).toBe('orig')
      if (change === 'edit') await writeFile(filename, 'modified')
      if (change === 'truncate') await truncate(filename, 2)
      if (change === 'replace') {
        await writeFile(path.join(workspace.root, 'new.txt'), 'original')
        await rename(path.join(workspace.root, 'new.txt'), filename)
      }
      if (change === 'delete' || change === 'symlink') await unlink(filename)
      if (change === 'symlink') {
        await writeFile(path.join(workspace.directory, 'outside.txt'), 'original')
        await symlink('../outside.txt', filename)
      }
      await expect(sessions.read(session.id, 0, 4, signal())).rejects.toMatchObject({
        code: 'FILE_CHANGED',
      })
      await expect(sessions.read(session.id, 0, 4, signal())).rejects.toMatchObject({
        code: 'READ_SESSION_EXPIRED',
      })
    } finally {
      await sessions.close()
    }
  },
)

test('mtime restoration cannot conceal an in-place edit', async ({ workspace }) => {
  const filename = path.join(workspace.root, 'file.txt')
  await writeFile(filename, 'original')
  const timestamp = new Date('2020-01-01')
  await utimes(filename, timestamp, timestamp)
  const sessions = new FileReadSessions(createWorkspacePaths(workspace.root), () => ({
    maxSessions: 1,
    maxRangeBytes: 8,
    idleMs: 60_000,
  }))
  try {
    const session = await sessions.open('file.txt', signal())
    await writeFile(filename, 'modified')
    await utimes(filename, timestamp, timestamp)
    await expect(sessions.read(session.id, 0, 8, signal())).rejects.toMatchObject({
      code: 'FILE_CHANGED',
    })
  } finally {
    await sessions.close()
  }
})

test('caps concurrent opens, rejects invalid ranges, and honors cancellation', async ({
  workspace,
}) => {
  await writeFile(path.join(workspace.root, 'file.txt'), 'data')
  const sessions = new FileReadSessions(createWorkspacePaths(workspace.root), () => ({
    maxSessions: 1,
    maxRangeBytes: 4,
    idleMs: 60_000,
  }))
  try {
    const results = await Promise.allSettled([
      sessions.open('file.txt', signal()),
      sessions.open('file.txt', signal()),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const accepted = results.find((result) => result.status === 'fulfilled')
    if (accepted?.status !== 'fulfilled') return expect.unreachable('Expected an open session')
    const id = accepted.value.id
    for (const [start, end] of [
      [-1, 1],
      [3, 2],
      [0, 5],
      [0.5, 1],
    ]) {
      await expect(sessions.read(id, start!, end!, signal())).rejects.toMatchObject({
        code: 'READ_RANGE_INVALID',
      })
    }
    const controller = new AbortController()
    controller.abort()
    await expect(sessions.read(id, 0, 4, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect((await sessions.read(id, 0, 4, signal())).bytes.byteLength).toBe(4)
  } finally {
    await sessions.close()
  }
})

test('idle expiry and shutdown release sessions', async ({ workspace }) => {
  await writeFile(path.join(workspace.root, 'file.txt'), 'data')
  const sessions = new FileReadSessions(createWorkspacePaths(workspace.root), () => ({
    maxSessions: 1,
    maxRangeBytes: 4,
    idleMs: 50,
  }))
  vi.useFakeTimers()
  try {
    const opened = await sessions.open('file.txt', signal())
    await vi.advanceTimersByTimeAsync(51)
    await expect(sessions.read(opened.id, 0, 4, signal())).rejects.toMatchObject({
      code: 'READ_SESSION_EXPIRED',
    })
    const next = await sessions.open('file.txt', signal())
    await sessions.close()
    await expect(sessions.read(next.id, 0, 4, signal())).rejects.toMatchObject({
      code: 'READ_SESSION_EXPIRED',
    })
    await expect(sessions.open('file.txt', signal())).rejects.toMatchObject({
      code: 'READ_SESSION_EXPIRED',
    })
  } finally {
    vi.useRealTimers()
    await sessions.close()
  }
})
