import { mkdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'
import { test, workspaceRequest as request } from '../../../test/factories/workspace-address'

test('browses directory links, reads file links, and retains broken links in listings', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.root, 'directory'))
  await writeFile(path.join(workspace.root, 'directory/note.txt'), 'linked content')
  await symlink('directory', path.join(workspace.root, 'directory-link'))
  await symlink('directory/note.txt', path.join(workspace.root, 'file-link'))
  await symlink('missing', path.join(workspace.root, 'broken-link'))
  const app = workspace.openApp()

  const listing = await request(app, '/fs/tree?depth=2')
  expect(listing.status).toBe(200)
  expect(await listing.json()).toMatchObject({
    entries: expect.arrayContaining([
      {
        name: 'directory-link',
        path: 'directory-link',
        type: 'symlink',
        targetType: 'directory',
        children: [expect.objectContaining({ path: 'directory-link/note.txt', type: 'file' })],
        size: expect.any(Number),
        mtimeMs: expect.any(Number),
        birthtimeMs: expect.any(Number),
        version: expect.any(String),
      },
      expect.objectContaining({ name: 'file-link', type: 'symlink', targetType: 'file' }),
      expect.objectContaining({ name: 'broken-link', type: 'symlink' }),
    ]),
  })
  expect(await (await request(app, '/fs/tree?path=directory-link')).json()).toMatchObject({
    path: 'directory-link',
    entries: [expect.objectContaining({ path: 'directory-link/note.txt' })],
  })
  expect(await (await request(app, '/fs/stat?path=file-link')).json()).toMatchObject({
    path: 'file-link',
    type: 'symlink',
    targetType: 'file',
  })
  expect(await (await request(app, '/fs/read?path=file-link')).json()).toMatchObject({
    content: 'linked content',
  })
  expect(await (await request(app, '/fs/blob?path=file-link')).text()).toBe('linked content')
  const broken = await (await request(app, '/fs/stat?path=broken-link')).json()
  expect(broken).toMatchObject({ type: 'symlink' })
  expect(broken).not.toHaveProperty('targetType')
  expect((await request(app, '/fs/read?path=broken-link')).status).toBe(404)
})

test('rejects browsing and reading symlink targets outside a restricted filesystem root', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.directory, 'outside'))
  await writeFile(path.join(workspace.directory, 'outside/private.txt'), 'outside content')
  await symlink('../outside', path.join(workspace.root, 'directory-link'))
  await symlink('../outside/private.txt', path.join(workspace.root, 'file-link'))
  const app = workspace.openApp()

  const listing = await request(app, '/fs/tree?depth=3')
  expect(listing.status).toBe(200)
  const tree = await listing.json()
  expect(tree.entries).toHaveLength(2)
  for (const entry of tree.entries) {
    expect(entry).toMatchObject({ type: 'symlink' })
    expect(entry).not.toHaveProperty('targetType')
    expect(entry).not.toHaveProperty('children')
  }
  const outsideLink = await (await request(app, '/fs/stat?path=file-link')).json()
  expect(outsideLink).toMatchObject({ path: 'file-link', type: 'symlink' })
  expect(outsideLink).not.toHaveProperty('targetType')

  for (const endpoint of [
    '/fs/tree?path=directory-link',
    '/fs/read?path=directory-link/private.txt',
    '/fs/read?path=file-link',
    '/fs/blob?path=file-link',
    '/fs/stat?path=directory-link/private.txt',
  ]) {
    const response = await request(app, endpoint)
    expect(response.status, endpoint).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'PATH_OUTSIDE_WORKSPACE' } })
  }
})

test('preserves the real containment boundary when the configured root is itself a symlink', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.root, 'directory'))
  await writeFile(path.join(workspace.root, 'directory/note.txt'), 'inside content')
  await symlink('directory', path.join(workspace.root, 'directory-link'))
  await symlink('root', path.join(workspace.directory, 'root-link'))
  const app = workspace.openApp(path.join(workspace.directory, 'root-link'))

  expect(await (await request(app, '/fs/tree?path=directory-link')).json()).toMatchObject({
    path: 'directory-link',
    entries: [expect.objectContaining({ path: 'directory-link/note.txt' })],
  })
  expect(await (await request(app, '/fs/read?path=directory-link/note.txt')).json()).toMatchObject({
    content: 'inside content',
  })
  expect(await (await request(app, '/fs/stat?path=')).json()).toMatchObject({
    path: '',
    type: 'directory',
  })
})
