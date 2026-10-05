import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'
import { test, workspaceRequest } from '../../../test/factories/workspace-address'
import { commitAtomicWrite, stageAtomicWrite } from '../atomic-write'
import { isWriteTemporaryPath, temporaryWritePath } from '../write'

test('tree reads hide issued staged saves and retain unrelated temporary files', async ({
  workspace,
}) => {
  const directory = path.join(workspace.root, 'docs')
  await mkdir(directory)
  const target = path.join(directory, 'notes.md')
  const external = path.join(directory, '.external.tmp')
  const foreignName = `.platform-write-${randomUUID()}-1.tmp`
  await writeFile(target, 'Original\n')
  await writeFile(external, 'External\n')
  await writeFile(path.join(workspace.root, foreignName), 'Foreign\n')
  const app = workspace.openApp()

  const baseline = await workspaceRequest(app, '/fs/tree?path=docs&depth=1')
  expect(baseline.status).toBe(200)
  expect(await baseline.json()).toMatchObject({
    entries: [{ name: '.external.tmp' }, { name: 'notes.md' }],
  })

  const temporary = temporaryWritePath(target)
  await stageAtomicWrite(temporary, 'Updated\n', { durability: 'fsync-all' })
  expect(isWriteTemporaryPath(temporary)).toBe(true)
  expect(isWriteTemporaryPath(foreignName)).toBe(false)
  expect(await readFile(temporary, 'utf8')).toBe('Updated\n')

  const staged = await workspaceRequest(app, '/fs/tree?path=&depth=3')
  expect(staged.status).toBe(200)
  expect(await staged.json()).toMatchObject({
    entries: [
      { name: 'docs', children: [{ name: '.external.tmp' }, { name: 'notes.md' }] },
      { name: foreignName },
    ],
  })

  await commitAtomicWrite(temporary, target, { durability: 'fsync-all' })
  expect(await readFile(target, 'utf8')).toBe('Updated\n')
  expect(await readFile(external, 'utf8')).toBe('External\n')
  const committed = await workspaceRequest(app, '/fs/tree?path=docs&depth=1')
  expect(committed.status).toBe(200)
  expect(await committed.json()).toMatchObject({
    entries: [{ name: '.external.tmp' }, { name: 'notes.md' }],
  })
})
