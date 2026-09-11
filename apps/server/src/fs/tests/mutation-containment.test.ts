import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { createWorkspacePaths } from '../path'
import { FileChangeHub } from '../watch'
import { isSameOrDescendant, WorkspaceEditController } from '../workspace-edit'
import { expect } from 'vitest'
import { test, workspaceRequest as request } from '../../../test/factories/workspace-address'

const escapingMutations = [
  {
    name: 'create a folder at the workspace parent',
    route: 'create-folder',
    body: { path: '..', recursive: true },
  },
  {
    name: 'write through a file link',
    route: 'write',
    body: { path: 'file-link', content: 'changed' },
  },
  {
    name: 'overwrite through a file link',
    route: 'create-file',
    body: { path: 'file-link', content: 'changed', overwrite: true },
  },
  {
    name: 'write a missing file through a directory link',
    route: 'write',
    body: { path: 'directory-link/new.txt', content: 'changed' },
  },
  {
    name: 'create a file through a directory link',
    route: 'create-file',
    body: { path: 'directory-link/new.txt', content: 'changed' },
  },
  {
    name: 'create missing parent directories through a directory link',
    route: 'create-folder',
    body: { path: 'directory-link/new/deep', recursive: true },
  },
  {
    name: 'create a folder at an external directory link',
    route: 'create-folder',
    body: { path: 'directory-link', recursive: true },
  },
  {
    name: 'copy into missing parents through a directory link',
    route: 'copy',
    body: { from: 'source.txt', to: 'directory-link/new/deep/copied.txt' },
  },
  {
    name: 'rename through a destination directory link',
    route: 'rename',
    body: { from: 'source.txt', to: 'directory-link/renamed.txt' },
  },
  {
    name: 'delete recursively through a directory link',
    route: 'delete',
    body: { path: 'directory-link/nested', recursive: true },
  },
  {
    name: 'copy an escaping source without removing an overwrite destination',
    route: 'copy',
    body: { from: 'directory-link/private.txt', to: 'destination.txt', overwrite: true },
  },
  {
    name: 'rename an escaping source without removing an overwrite destination',
    route: 'rename',
    body: { from: 'directory-link/private.txt', to: 'destination.txt', overwrite: true },
  },
  {
    name: 'copy without removing an escaping overwrite destination',
    route: 'copy',
    body: { from: 'source.txt', to: 'directory-link/private.txt', overwrite: true },
  },
  {
    name: 'rename without removing an escaping overwrite destination',
    route: 'rename',
    body: { from: 'source.txt', to: 'directory-link/private.txt', overwrite: true },
  },
] as const

for (const scenario of escapingMutations) {
  test(`rejects ${scenario.name} before changing disk`, async ({ workspace }) => {
    const outside = path.join(workspace.directory, 'outside')
    await mkdir(path.join(outside, 'nested'), { recursive: true })
    await writeFile(path.join(outside, 'private.txt'), 'private contents')
    await writeFile(path.join(outside, 'nested/keep.txt'), 'nested contents')
    await writeFile(path.join(workspace.root, 'source.txt'), 'source contents')
    await writeFile(path.join(workspace.root, 'destination.txt'), 'destination contents')
    await symlink('../outside', path.join(workspace.root, 'directory-link'))
    await symlink('../outside/private.txt', path.join(workspace.root, 'file-link'))
    const beforeOutside = await snapshotTree(outside)
    const beforeWorkspace = await snapshotTree(workspace.root)

    const response = await request(workspace.openApp(), `/fs/${scenario.route}`, scenario.body)

    expect.soft(await snapshotTree(outside)).toEqual(beforeOutside)
    expect.soft(await snapshotTree(workspace.root)).toEqual(beforeWorkspace)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'PATH_OUTSIDE_WORKSPACE' } })
  })
}

test('workspace edit directional containment excludes the immediate parent', () => {
  const root = path.resolve('/workspace/project')

  expect(isSameOrDescendant(root, path.dirname(root))).toBe(false)
  expect(isSameOrDescendant(path.dirname(root), root)).toBe(true)
  expect(isSameOrDescendant(root, path.join(root, '..foo'))).toBe(true)
})

test('workspace edit mutation gate rejects the workspace parent before calling the mutation', async ({
  workspace,
}) => {
  const paths = createWorkspacePaths(workspace.root)
  const changes = new FileChangeHub(paths, { enabled: false })
  const controller = new WorkspaceEditController({
    paths,
    changes,
    journalRoot: path.join(workspace.directory, 'journal'),
  })
  let called = false
  try {
    await expect(
      controller.withLegacyMutation([workspace.directory], async () => {
        called = true
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_INVALID' })
    expect(called).toBe(false)
  } finally {
    await controller.close()
    await changes.close()
  }
})

test('mutates internal file and directory aliases without replacing the links', async ({
  workspace,
}) => {
  const realDirectory = path.join(workspace.root, 'real')
  await mkdir(realDirectory)
  await writeFile(path.join(realDirectory, 'note.txt'), 'original')
  await symlink('real', path.join(workspace.root, 'directory-link'))
  await symlink('real/note.txt', path.join(workspace.root, 'file-link'))
  const app = workspace.openApp()

  expect((await request(app, '/fs/write', { path: 'file-link', content: 'saved' })).status).toBe(
    200,
  )
  expect(await readFile(path.join(realDirectory, 'note.txt'), 'utf8')).toBe('saved')
  expect(
    (
      await request(app, '/fs/create-file', {
        path: 'file-link',
        content: 'replaced',
        overwrite: true,
      })
    ).status,
  ).toBe(200)
  expect(await readFile(path.join(realDirectory, 'note.txt'), 'utf8')).toBe('replaced')
  expect(
    (await request(app, '/fs/create-file', { path: 'directory-link/new.txt', content: 'new' }))
      .status,
  ).toBe(200)
  expect(await readFile(path.join(realDirectory, 'new.txt'), 'utf8')).toBe('new')
  expect(
    (await request(app, '/fs/create-folder', { path: 'directory-link/nested', recursive: true }))
      .status,
  ).toBe(200)
  expect(
    (
      await request(app, '/fs/copy', {
        from: 'directory-link/new.txt',
        to: 'directory-link/nested/deep/copied.txt',
      })
    ).status,
  ).toBe(200)
  expect(await readFile(path.join(realDirectory, 'nested/deep/copied.txt'), 'utf8')).toBe('new')
  expect(
    (
      await request(app, '/fs/rename', {
        from: 'directory-link/nested/deep/copied.txt',
        to: 'directory-link/nested/renamed.txt',
      })
    ).status,
  ).toBe(200)
  expect(await readFile(path.join(realDirectory, 'nested/renamed.txt'), 'utf8')).toBe('new')
  expect(
    (await request(app, '/fs/delete', { path: 'directory-link/nested', recursive: true })).status,
  ).toBe(200)
  expect((await readdir(realDirectory)).sort()).toEqual(['new.txt', 'note.txt'])
  expect(await readlink(path.join(workspace.root, 'file-link'))).toBe('real/note.txt')
  expect(await readlink(path.join(workspace.root, 'directory-link'))).toBe('real')
})

test('uses the physical boundary when the configured root is itself a link', async ({
  workspace,
}) => {
  const outside = path.join(workspace.directory, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'keep.txt'), 'outside contents')
  await symlink('../outside', path.join(workspace.root, 'escape'))
  const rootAlias = path.join(workspace.directory, 'root-alias')
  await symlink('root', rootAlias)
  const app = workspace.openApp(rootAlias)

  expect((await request(app, '/fs/write', { path: 'inside.txt', content: 'inside' })).status).toBe(
    200,
  )
  expect(await readFile(path.join(workspace.root, 'inside.txt'), 'utf8')).toBe('inside')
  const beforeOutside = await snapshotTree(outside)
  const beforeWorkspace = await snapshotTree(workspace.root)

  const response = await request(app, '/fs/create-file', {
    path: 'escape/new.txt',
    content: 'changed',
  })

  expect(await snapshotTree(outside)).toEqual(beforeOutside)
  expect(await snapshotTree(workspace.root)).toEqual(beforeWorkspace)
  expect(response.status).toBe(403)
})

test('opening a nested project keeps sibling files inside the manual mutation boundary', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.root, 'project'))
  await writeFile(path.join(workspace.root, 'sibling.txt'), 'before')
  const app = workspace.openApp()

  const opened = await request(app, '/fs/workspace-root', { path: 'project', generation: 1 })
  expect(opened.status).toBe(200)
  expect(await opened.json()).toMatchObject({ status: 'opened', entry: { path: 'project' } })

  const written = await request(app, '/fs/write', { path: 'sibling.txt', content: 'after' })

  expect(written.status).toBe(200)
  expect(await readFile(path.join(workspace.root, 'sibling.txt'), 'utf8')).toBe('after')
})

for (const route of ['write', 'create-file']) {
  test(`${route} preserves existing file permissions through an internal link`, async ({
    workspace,
  }) => {
    const target = path.join(workspace.root, 'script.sh')
    await writeFile(target, 'before')
    await chmod(target, 0o751)
    await symlink('script.sh', path.join(workspace.root, 'link'))

    const response = await request(workspace.openApp(), `/fs/${route}`, {
      path: 'link',
      content: 'after',
      overwrite: true,
    })

    expect(response.status).toBe(200)
    expect(await readFile(target, 'utf8')).toBe('after')
    expect((await lstat(target)).mode & 0o777).toBe(0o751)
    expect(await readlink(path.join(workspace.root, 'link'))).toBe('script.sh')
  })

  test(`${route} refuses to create the target of a dangling link`, async ({ workspace }) => {
    const outside = path.join(workspace.directory, 'outside')
    await mkdir(outside)
    await symlink('../outside/missing.txt', path.join(workspace.root, 'link'))
    const beforeOutside = await snapshotTree(outside)
    const beforeWorkspace = await snapshotTree(workspace.root)

    const response = await request(workspace.openApp(), `/fs/${route}`, {
      path: 'link',
      content: 'changed',
      overwrite: true,
    })

    expect(await snapshotTree(outside)).toEqual(beforeOutside)
    expect(await snapshotTree(workspace.root)).toEqual(beforeWorkspace)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
}

test('refuses a stale save through an internal link before creating temporary files', async ({
  workspace,
}) => {
  const target = path.join(workspace.root, 'note.txt')
  await writeFile(target, 'opened contents')
  await symlink('note.txt', path.join(workspace.root, 'link'))
  const app = workspace.openApp()
  const opened = await request(app, '/fs/read?path=link')
  expect(opened.status).toBe(200)
  const { version } = await opened.json()
  await writeFile(target, 'changed externally')
  const before = await snapshotTree(workspace.root)

  const response = await request(app, '/fs/write', {
    path: 'link',
    content: 'stale editor contents',
    baseVersion: version,
  })

  expect(await snapshotTree(workspace.root)).toEqual(before)
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ error: { code: 'FILE_CHANGED' } })
})

test('does not treat a dangling parent link as a missing directory', async ({ workspace }) => {
  const outside = path.join(workspace.directory, 'outside')
  await mkdir(outside)
  await symlink('../outside/missing', path.join(workspace.root, 'link'))
  const beforeOutside = await snapshotTree(outside)
  const beforeWorkspace = await snapshotTree(workspace.root)

  const response = await request(workspace.openApp(), '/fs/create-folder', {
    path: 'link/new/deep',
    recursive: true,
  })

  expect(await snapshotTree(outside)).toEqual(beforeOutside)
  expect(await snapshotTree(workspace.root)).toEqual(beforeWorkspace)
  expect(response.status).toBe(404)
  expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
})

for (const targetName of ['keep.txt', 'missing.txt']) {
  for (const operation of ['copy', 'rename', 'delete']) {
    test(`${operation} acts on an external ${targetName} link entry`, async ({ workspace }) => {
      const outside = path.join(workspace.directory, 'outside')
      await mkdir(outside)
      await writeFile(path.join(outside, 'keep.txt'), 'outside contents')
      await symlink(`../outside/${targetName}`, path.join(workspace.root, 'link'))
      const beforeOutside = await snapshotTree(outside)
      const body = operation === 'delete' ? { path: 'link' } : { from: 'link', to: 'result' }

      const response = await request(workspace.openApp(), `/fs/${operation}`, body)

      expect(await snapshotTree(outside)).toEqual(beforeOutside)
      expect(response.status).toBe(200)
      if (operation !== 'copy') {
        await expect(lstat(path.join(workspace.root, 'link'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      }
      if (operation === 'delete') return

      const resultPath = path.join(workspace.root, 'result')
      expect((await lstat(resultPath)).isSymbolicLink()).toBe(true)
      expect(path.resolve(workspace.root, await readlink(resultPath))).toBe(
        path.join(outside, targetName),
      )
    })
  }
}

test('recursive copy and delete preserve targets of nested external directory links', async ({
  workspace,
}) => {
  const outside = path.join(workspace.directory, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'keep.txt'), 'outside contents')
  await mkdir(path.join(workspace.root, 'source'))
  await writeFile(path.join(workspace.root, 'source/note.txt'), 'inside contents')
  await symlink('../../outside', path.join(workspace.root, 'source/link'))
  const app = workspace.openApp()
  const beforeOutside = await snapshotTree(outside)

  const copied = await request(app, '/fs/copy', { from: 'source', to: 'copied', recursive: true })

  expect(await snapshotTree(outside)).toEqual(beforeOutside)
  expect(copied.status).toBe(200)
  expect((await lstat(path.join(workspace.root, 'copied/link'))).isSymbolicLink()).toBe(true)
  expect(await readFile(path.join(workspace.root, 'copied/note.txt'), 'utf8')).toBe(
    'inside contents',
  )

  for (const target of ['source', 'copied']) {
    const deleted = await request(app, '/fs/delete', { path: target, recursive: true })
    expect(await snapshotTree(outside)).toEqual(beforeOutside)
    expect(deleted.status).toBe(200)
    await expect(lstat(path.join(workspace.root, target))).rejects.toMatchObject({ code: 'ENOENT' })
  }
})

const overlappingTargets = [
  { name: 'same file through an alias', from: 'real/note.txt', to: 'alias/note.txt' },
  { name: 'destination inside source through an alias', from: 'real', to: 'alias/nested' },
  { name: 'destination containing source through an alias', from: 'alias/nested', to: 'real' },
] as const

for (const operation of ['copy', 'rename']) {
  for (const target of overlappingTargets) {
    test(`rejects ${operation} onto ${target.name} before overwrite removal`, async ({
      workspace,
    }) => {
      await mkdir(path.join(workspace.root, 'real/nested'), { recursive: true })
      await writeFile(path.join(workspace.root, 'real/note.txt'), 'parent contents')
      await writeFile(path.join(workspace.root, 'real/nested/keep.txt'), 'child contents')
      await symlink('real', path.join(workspace.root, 'alias'))
      const before = await snapshotTree(workspace.root)

      const response = await request(workspace.openApp(), `/fs/${operation}`, {
        from: target.from,
        to: target.to,
        overwrite: true,
        recursive: true,
      })

      expect(await snapshotTree(workspace.root)).toEqual(before)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_PATH' } })
    })
  }
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {}
  await recordTree(root, '', snapshot)
  return snapshot
}

async function recordTree(root: string, prefix: string, snapshot: Record<string, string>) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = path.join(prefix, entry.name)
    const absolutePath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      snapshot[name] = 'directory'
      await recordTree(absolutePath, name, snapshot)
      continue
    }
    if (entry.isSymbolicLink()) {
      snapshot[name] = `symlink:${await readlink(absolutePath)}`
      continue
    }
    snapshot[name] = `file:${await readFile(absolutePath, 'utf8')}`
  }
}
