import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { workspaceAddressSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { expect } from 'vitest'
import { test, workspaceRequest as request } from '../../../test/factories/workspace-address'

test('registers canonical directory identity across symlink aliases without activating an index', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.root, 'packages/library'), { recursive: true })
  await symlink('packages/library', path.join(workspace.root, 'alias'))
  const app = workspace.openApp()
  const responses = await Promise.all(
    ['alias', 'packages/library'].map((entry) =>
      request(app, '/fs/workspace-address', { path: entry }),
    ),
  )
  expect(responses.map((response) => response.status)).toEqual([200, 200])
  const [alias, canonical] = await Promise.all(
    responses.map(async (response) => v.parse(workspaceAddressSchema, await response.json())),
  )
  expect(alias).toEqual(canonical)
  expect(canonical).toMatchObject({ name: 'library', path: 'packages/library' })
  expect(canonical.id).toHaveLength(16)
  expect(canonical.id).toMatch(/^[A-Za-z0-9_-]{16}$/)
  expect(await (await request(app, '/health')).json()).toMatchObject({
    workspaceIndex: { scanRoot: null },
  })
  expect(
    await (await request(app, '/fs/recents?mode=folder&showHidden=true')).json(),
  ).toMatchObject({ entries: [] })

  const opened = await request(app, '/fs/workspace-root', { generation: 1, path: 'alias' })
  expect(opened.status).toBe(200)
  expect(await opened.json()).toMatchObject({
    status: 'opened',
    entry: {
      type: 'directory',
      path: 'packages/library',
      canonicalPath: 'packages/library',
      workspaceAddress: canonical,
    },
    workspaceIndex: { scanRoot: path.join(workspace.root, 'packages/library') },
  })
})

test('assigns distinct addresses to an empty namespace root and arbitrary nested directories', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.root, 'plain/nested'), { recursive: true })
  const app = workspace.openApp()
  const root = v.parse(
    workspaceAddressSchema,
    await (await request(app, '/fs/workspace-address', { path: '' })).json(),
  )
  const nested = v.parse(
    workspaceAddressSchema,
    await (await request(app, '/fs/workspace-address', { path: 'plain/nested' })).json(),
  )
  expect(root).toMatchObject({ path: '', name: 'root' })
  expect(nested).toMatchObject({ path: 'plain/nested', name: 'nested' })
  expect(root.id).not.toBe(nested.id)
  expect(await (await request(app, `/fs/workspace-address/${root.id}`)).json()).toEqual(root)
})

test('resolves and reuses the address after all apps and database handles restart', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.root, 'project'))
  const app = workspace.openApp()
  const registered = v.parse(
    workspaceAddressSchema,
    await (await request(app, '/fs/workspace-address', { path: 'project' })).json(),
  )
  await workspace.closeApps()

  const restarted = workspace.openApp()
  const resolved = await request(restarted, `/fs/workspace-address/${registered.id}`)
  expect(resolved.status).toBe(200)
  expect(await resolved.json()).toEqual(registered)
  expect(
    await (await request(restarted, '/fs/workspace-address', { path: 'project' })).json(),
  ).toEqual(registered)
  expect(
    await (await request(restarted, '/fs/recents?mode=folder&showHidden=true')).json(),
  ).toMatchObject({ entries: [] })
})

test('rejects unknown IDs, files, absent paths, and paths escaping the filesystem namespace', async ({
  workspace,
}) => {
  await writeFile(path.join(workspace.root, 'file'), 'text')
  await mkdir(path.join(workspace.directory, 'outside'))
  await symlink('../outside', path.join(workspace.root, 'escape'))
  const app = workspace.openApp()
  const unknown = await request(app, '/fs/workspace-address/Missing_ID-12345')
  expect(unknown.status).toBe(404)
  expect(await unknown.json()).toMatchObject({ error: { code: 'WORKSPACE_ADDRESS_NOT_FOUND' } })
  expect((await request(app, '/fs/workspace-address/not-an-id')).status).toBe(400)
  expect(
    (await request(app, '/fs/workspace-address/00000000-0000-4000-8000-000000000001')).status,
  ).toBe(400)
  for (const [entry, status] of [
    ['file', 400],
    ['missing', 404],
    ['../outside', 403],
    ['escape', 403],
  ] as const) {
    expect((await request(app, '/fs/workspace-address', { path: entry })).status).toBe(status)
  }
  expect((await request(app, '/fs/workspace-root', { generation: 1, path: 'escape' })).status).toBe(
    403,
  )
})

test('revalidates resolved directories and never retargets a stored ID through a replacement symlink', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.root, 'project'))
  await mkdir(path.join(workspace.root, 'other'))
  await mkdir(path.join(workspace.directory, 'outside'))
  const app = workspace.openApp()
  const registered = v.parse(
    workspaceAddressSchema,
    await (await request(app, '/fs/workspace-address', { path: 'project' })).json(),
  )
  const endpoint = `/fs/workspace-address/${registered.id}`
  await rm(path.join(workspace.root, 'project'), { recursive: true })
  expect((await request(app, endpoint)).status).toBe(404)
  await symlink('../outside', path.join(workspace.root, 'project'))
  expect((await request(app, endpoint)).status).toBe(403)
  await rm(path.join(workspace.root, 'project'))
  await symlink('other', path.join(workspace.root, 'project'))
  const retargeted = await request(app, endpoint)
  expect(retargeted.status).toBe(404)
  expect(await retargeted.json()).toMatchObject({ error: { code: 'WORKSPACE_ADDRESS_NOT_FOUND' } })
})

test('keys identity by the real filesystem namespace and canonical directory together', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.root, 'project'))
  await symlink('root', path.join(workspace.directory, 'root-alias'))
  const app = workspace.openApp()
  const registered = v.parse(
    workspaceAddressSchema,
    await (await request(app, '/fs/workspace-address', { path: 'project' })).json(),
  )
  const aliasApp = workspace.openApp(path.join(workspace.directory, 'root-alias'))
  expect(
    await (await request(aliasApp, '/fs/workspace-address', { path: 'project' })).json(),
  ).toEqual(registered)

  const nestedApp = workspace.openApp(path.join(workspace.root, 'project'))
  const nested = v.parse(
    workspaceAddressSchema,
    await (await request(nestedApp, '/fs/workspace-address', { path: '' })).json(),
  )
  expect(nested.id).not.toBe(registered.id)
  expect((await request(nestedApp, `/fs/workspace-address/${registered.id}`)).status).toBe(404)
})

test('register and GET resolution leave the active index, open generation, and recents alone', async ({
  workspace,
}) => {
  await mkdir(path.join(workspace.root, 'active'))
  await mkdir(path.join(workspace.root, 'linked'))
  const app = workspace.openApp()
  expect((await request(app, '/fs/workspace-root', { generation: 1, path: 'active' })).status).toBe(
    200,
  )
  const registered = v.parse(
    workspaceAddressSchema,
    await (await request(app, '/fs/workspace-address', { path: 'linked' })).json(),
  )
  for (let index = 0; index < 3; index += 1) {
    expect(await (await request(app, `/fs/workspace-address/${registered.id}`)).json()).toEqual(
      registered,
    )
  }
  expect(await (await request(app, '/health')).json()).toMatchObject({
    workspaceIndex: { scanRoot: path.join(workspace.root, 'active') },
  })
  expect(
    await (await request(app, '/fs/recents?mode=folder&showHidden=true')).json(),
  ).toMatchObject({ entries: [] })
  const opened = await request(app, '/fs/workspace-root', { generation: 2, path: 'linked' })
  expect(await opened.json()).toMatchObject({
    status: 'opened',
    entry: { workspaceAddress: registered },
  })
})
