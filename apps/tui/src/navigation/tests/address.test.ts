import { emptyAddress, formatAddress, parseAddress } from '@workspace/client-core/address/grammar'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { registerWorkspaceAddress } from '@workspace/client-core/files/workspace-address'
import { mkdir, symlink } from 'node:fs/promises'
import path from 'node:path'
import { readServerPaths } from '@workspace/client-core/files/read'
import { environmentIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

import {
  fileAddress,
  resolveAddress,
  settingsAddress,
  workbenchAddress,
} from '@/navigation/utils/address'
import { test, expect } from '../../../test/fixtures'

const environmentId = v.parse(environmentIdSchema, '11111111-1111-4111-8111-111111111111')

test('settings addresses round-trip filters and reject foreign environments', async ({
  client,
}) => {
  const signal = new AbortController().signal
  const own = settingsAddress(environmentId, 'Appearance & motion')
  expect(parseAddress(own).document).toBe('settings')
  expect(await resolveAddress(own, client, environmentId, signal)).toEqual({
    kind: 'settings',
    query: 'Appearance & motion',
  })
  const foreign = own.replace(environmentId, '22222222-2222-4222-8222-222222222222')
  expect(await resolveAddress(foreign, client, environmentId, signal)).toMatchObject({
    kind: 'failed',
  })
})

test('copied file and directory addresses return to the same server path', async ({ client }) => {
  const signal = new AbortController().signal
  const paths = await readServerPaths({ client, signal })
  const filename = paths.defaultPath ? `${paths.defaultPath}/a~b!.ts` : 'a~b!.ts'
  const file = await fileAddress(environmentId, filename, paths.defaultPath, { client, signal })
  const directory = await fileAddress(environmentId, paths.defaultPath, paths.defaultPath, {
    client,
    signal,
  })
  expect(await resolveAddress(file!, client, environmentId, signal)).toEqual({
    kind: 'workbench',
    rootPath: paths.defaultPath,
    pane: 'files',
    path: filename,
  })
  expect(await resolveAddress(directory!, client, environmentId, signal)).toEqual({
    kind: 'workbench',
    rootPath: paths.defaultPath,
    pane: 'files',
  })
  expect(
    await fileAddress(environmentId, '../secret', paths.defaultPath, { client, signal }),
  ).toBeNull()
})

test('resolves a file address through real server paths without changing the active project', async ({
  client,
}) => {
  const signal = new AbortController().signal
  const paths = await readServerPaths({ client, signal })
  const address = formatAddress({
    ...emptyAddress(),
    environmentId,
    workspace: workspaceToken(
      await registerWorkspaceAddress({ client, signal, path: paths.defaultPath }),
    ),
    mode: 'workbench',
    document: 'f/a%7Eb%21.ts',
    settings: 'Appearance',
  })
  expect(await resolveAddress(address, client, environmentId, signal)).toEqual({
    kind: 'workbench',
    rootPath: paths.defaultPath,
    pane: 'files',
    path: paths.defaultPath ? `${paths.defaultPath}/a~b!.ts` : 'a~b!.ts',
  })
  expect(await readServerPaths({ client, signal })).toEqual(paths)
})

test('workbench addresses preserve project, pane and file position across each pane', async ({
  client,
  server,
}) => {
  const signal = new AbortController().signal
  await mkdir(path.join(server.root, 'project'))
  for (const pane of ['files', 'git', 'search', 'terminal', 'problems', 'logs'] as const) {
    const location = {
      kind: 'workbench',
      rootPath: 'project',
      path: 'project/src/main.ts',
      line: 42,
      pane,
    } as const
    const address = await workbenchAddress(environmentId, location, { client, signal })
    expect(await resolveAddress(address, client, environmentId, signal)).toEqual(location)
  }
})

test('unavailable screen types and escaped traversal cannot become file requests', async ({
  client,
}) => {
  const signal = new AbortController().signal
  expect(
    await resolveAddress('/~Workspace/chat/t/new', client, environmentId, signal),
  ).toMatchObject({ kind: 'failed' })
  expect(
    await resolveAddress('/~Workspace/workbench/f/%2E%2E/secret', client, environmentId, signal),
  ).toMatchObject({ kind: 'failed' })
})

test('workspace links survive a fresh resolver and ignore decorative names', async ({
  client,
  server,
}) => {
  const signal = new AbortController().signal
  await mkdir(path.join(server.root, 'first', 'project'), { recursive: true })
  await mkdir(path.join(server.root, 'second', 'project'), { recursive: true })
  const location = {
    kind: 'workbench',
    rootPath: 'first/project',
    path: 'first/project/main.ts',
    pane: 'files',
  } as const
  const address = await workbenchAddress(environmentId, location, { client, signal })
  const renamed = address.replace('~project.', '~anything.')
  expect(await resolveAddress(renamed, client, environmentId, signal)).toEqual(location)
  const other = await workbenchAddress(
    environmentId,
    { ...location, rootPath: 'second/project', path: 'second/project/main.ts' },
    { client, signal },
  )
  expect(parseAddress(other).workspace).not.toBe(parseAddress(address).workspace)
})

test('alias links resolve to one canonical root and preserve relative file positions', async ({
  client,
  server,
}) => {
  const signal = new AbortController().signal
  await mkdir(path.join(server.root, 'project'))
  await symlink('project', path.join(server.root, 'alias'))
  const canonical = {
    kind: 'workbench',
    rootPath: 'project',
    path: 'project/main.ts',
    pane: 'files',
    line: 9,
  } as const
  const alias = { ...canonical, rootPath: 'alias', path: 'alias/main.ts' }
  const first = await workbenchAddress(environmentId, canonical, { client, signal })
  const second = await workbenchAddress(environmentId, alias, { client, signal })
  expect(second).toBe(first)
  expect(await resolveAddress(second, client, environmentId, signal)).toEqual(canonical)
})
