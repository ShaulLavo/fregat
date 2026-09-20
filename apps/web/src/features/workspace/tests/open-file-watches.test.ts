import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { OpenFileWatches } from '../../../../../server/src/fs/open-file-watches'
import { createWorkspacePaths } from '../../../../../server/src/fs/path'

import { test, expect } from '../../../../test/fixtures'
import { watchFilesystem } from '../../../../test/factories/filesystem-events'

test('recovers a missing linked directory and releases shared watches after reattachment', async ({
  server,
}) => {
  await mkdir(path.join(server.root, 'project'))
  await mkdir(path.join(server.root, 'target', 'nested'), { recursive: true })
  await symlink('../link', path.join(server.root, 'project', 'linked'))
  await symlink('target', path.join(server.root, 'link'))
  const disk = path.join(server.root, 'target', 'nested', 'a.txt')
  const alias = 'project/linked/nested/a.txt'
  await writeFile(disk, 'before')
  const events: string[] = []
  const errors: unknown[] = []
  const watches = new OpenFileWatches(
    createWorkspacePaths(server.root),
    (file) => events.push(file),
    (error) => errors.push(error),
  )
  try {
    const first = await watches.retain(alias, ['project'])
    const count = watches.size
    const second = await watches.retain(alias, ['project'])
    expect(watches.size).toBe(count)
    expect(events).toEqual([])
    await rm(path.join(server.root, 'target'), { recursive: true })
    await expect.poll(() => events).toContain(alias)
    events.length = 0
    await mkdir(path.join(server.root, 'target', 'nested'), { recursive: true })
    await writeFile(disk, 'recreated')
    await expect.poll(() => events).toContain(alias)
    first()
    events.length = 0
    await writeFile(disk, 'after recreation')
    await expect.poll(() => events).toContain(alias)
    second()
    await expect.poll(() => watches.size).toBe(0)
    expect(errors).toEqual([])
    const pending = watches.retain(alias, ['project'])
    watches.close()
    await pending
    expect(watches.size).toBe(0)
  } finally {
    watches.close()
  }
})

test('reattaches linked open files after symlink retargeting and target directory replacement', async ({
  server,
  client,
}) => {
  await mkdir(path.join(server.root, 'project'))
  await mkdir(path.join(server.root, 'first'))
  await mkdir(path.join(server.root, 'second'))
  await symlink('../first', path.join(server.root, 'project', 'linked'))
  await writeFile(path.join(server.root, 'first', 'a.txt'), 'first')
  await writeFile(path.join(server.root, 'second', 'a.txt'), 'second')
  const alias = 'project/linked/a.txt'
  const watch = watchFilesystem(client, 'project', [alias])
  const changed = expect.objectContaining({ type: 'changed', path: alias })
  try {
    await expect.poll(() => watch.events).toContainEqual(expect.objectContaining({ type: 'ready' }))
    await symlink('../second', path.join(server.root, 'project', 'replacement'))
    await rename(
      path.join(server.root, 'project', 'replacement'),
      path.join(server.root, 'project', 'linked'),
    )
    await expect.poll(() => watch.events).toContainEqual(changed)
    watch.events.length = 0
    await writeFile(path.join(server.root, 'second', 'a.txt'), 'edit after retarget')
    await expect.poll(() => watch.events).toContainEqual(changed)
    watch.events.length = 0
    await rename(path.join(server.root, 'second'), path.join(server.root, 'old-second'))
    await mkdir(path.join(server.root, 'second'))
    await writeFile(path.join(server.root, 'second', 'a.txt'), 'replacement directory')
    await expect.poll(() => watch.events).toContainEqual(changed)
    watch.events.length = 0
    await writeFile(path.join(server.root, 'second', 'a.txt'), 'edit after replacement')
    await expect.poll(() => watch.events).toContainEqual(changed)
    expect(watch.errors).toEqual([])
    expect(watch.events.some((event) => event.type === 'error')).toBe(false)
  } finally {
    await watch.stop()
  }
})

test('watches linked open files through their editor paths across replacement and recreation', async ({
  server,
  client,
}) => {
  await mkdir(path.join(server.root, 'project'))
  await mkdir(path.join(server.root, 'target'))
  await symlink('../target', path.join(server.root, 'project', 'linked'))
  const disk = path.join(server.root, 'target', 'a,b.txt')
  const alias = 'project/linked/a,b.txt'
  await writeFile(disk, 'before')
  const watch = watchFilesystem(client, 'project', [alias])
  try {
    await expect.poll(() => watch.events).toContainEqual(expect.objectContaining({ type: 'ready' }))
    await writeFile(disk, 'after')
    await expect
      .poll(() => watch.events)
      .toContainEqual(expect.objectContaining({ type: 'changed', path: alias }))
    watch.events.length = 0
    await writeFile(`${disk}.tmp`, 'replacement')
    await rename(`${disk}.tmp`, disk)
    await expect
      .poll(() => watch.events)
      .toContainEqual(expect.objectContaining({ type: 'changed', path: alias }))
    watch.events.length = 0
    await rm(disk)
    await expect
      .poll(() => watch.events)
      .toContainEqual(expect.objectContaining({ type: 'deleted', path: alias }))
    watch.events.length = 0
    await writeFile(disk, 'recreated')
    await expect
      .poll(() => watch.events)
      .toContainEqual(expect.objectContaining({ type: 'changed', path: alias }))
    expect(watch.events.some((event) => event.type === 'error')).toBe(false)
  } finally {
    await watch.stop()
  }
})

test('keeps shared linked watches alive when one subscriber closes and includes explicitly open ignored files', async ({
  server,
  client,
}) => {
  await mkdir(path.join(server.root, 'project'))
  await mkdir(path.join(server.root, 'target'))
  await mkdir(path.join(server.root, 'project', 'dist'))
  await symlink('../target', path.join(server.root, 'project', 'linked'))
  await writeFile(path.join(server.root, 'target', 'a.txt'), 'before')
  await writeFile(path.join(server.root, 'project', 'dist', 'open.txt'), 'before')
  const alias = 'project/linked/a.txt'
  const files = [alias, 'project/dist/open.txt']
  const first = watchFilesystem(client, 'project', files)
  const second = watchFilesystem(client, 'project', files)
  try {
    await expect.poll(() => first.events).toContainEqual(expect.objectContaining({ type: 'ready' }))
    await expect
      .poll(() => second.events)
      .toContainEqual(expect.objectContaining({ type: 'ready' }))
    await first.stop()
    await writeFile(path.join(server.root, 'target', 'a.txt'), 'after')
    await writeFile(path.join(server.root, 'project', 'dist', 'open.txt'), 'after')
    await expect
      .poll(() => second.events)
      .toContainEqual(expect.objectContaining({ type: 'changed', path: alias }))
    await expect
      .poll(() => second.events)
      .toContainEqual(expect.objectContaining({ type: 'changed', path: 'project/dist/open.txt' }))
    expect(second.events.some((event) => event.type === 'error')).toBe(false)
  } finally {
    await first.stop()
    await second.stop()
  }
})
