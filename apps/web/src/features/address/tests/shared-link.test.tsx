import { waitFor } from '@testing-library/react'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { healthDescriptorSchema } from '@workspace/contracts'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { expect, test } from '../../../../test/fixtures'
import { createObservedInProcessClient } from '../../../../test/client'
import { scopeAddressEnvironment } from '../../../../test/factories/address-environment'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import {
  editorTabPaths,
  flushProjection,
  renderAddressHarness,
  seedWorkspaceCache,
  startAt,
} from '../../../../test/address'

test('an empty browser opens the exact shared checkout while recent-folder reads are pending', async ({
  client,
  server,
}) => {
  await mkdir(path.join(server.root, 'projects/platform'), { recursive: true })
  await mkdir(path.join(server.root, 'forks/platform'), { recursive: true })
  await writeFile(
    path.join(server.root, 'projects/platform/shared.ts'),
    'export const shared = 1\n',
  )
  const target = await registerTestWorkspaceAddress(client, 'projects/platform')
  const other = await registerTestWorkspaceAddress(client, 'forks/platform')
  expect(target.id).not.toBe(other.id)
  const requests: string[] = []
  const releaseRecents = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    const pathname = new URL(request.url).pathname
    requests.push(pathname)
    if (pathname === '/fs/recents') await releaseRecents.promise
  })
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const restoreEnvironment = scopeAddressEnvironment(
    'http://localhost:37901',
    descriptor.environmentId,
    observed,
  )
  localStorage.clear()
  startAt(`/~${workspaceToken(target)}/workbench/f/shared.ts?side=git`)
  const rendered = await renderAddressHarness()
  try {
    await waitFor(() =>
      expect(rendered.harness.workspace.getState().rootFolder).toMatchObject({
        path: target.path,
        workspaceAddress: target,
      }),
    )
    await flushProjection()
    expect(editorTabPaths(rendered.harness.workspace)).toEqual(['projects/platform/shared.ts'])
    expect(requests).toContain(`/fs/workspace-address/${target.id}`)
    expect(location.pathname).toBe(`/~${workspaceToken(target)}/workbench/f/shared.ts`)
  } finally {
    releaseRecents.resolve()
    rendered.unmount()
    rendered.application.dispose()
    restoreEnvironment()
  }
})

test('changing the readable name never redirects a shared link to a remembered checkout', async ({
  client,
  server,
}) => {
  await mkdir(path.join(server.root, 'projects/platform'), { recursive: true })
  await mkdir(path.join(server.root, 'forks/platform'), { recursive: true })
  await writeFile(
    path.join(server.root, 'projects/platform/shared.ts'),
    'export const shared = 1\n',
  )
  const target = await registerTestWorkspaceAddress(client, 'projects/platform')
  const remembered = await registerTestWorkspaceAddress(client, 'forks/platform')
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const restoreEnvironment = scopeAddressEnvironment(
    'http://localhost:37902',
    descriptor.environmentId,
    client,
  )
  localStorage.clear()
  seedWorkspaceCache({ rootPath: remembered.path, workspaceAddress: remembered })
  const misleadingToken = workspaceToken({ ...target, name: 'a.different.checkout' })
  startAt(`/~${misleadingToken}/workbench/f/shared.ts`)
  const rendered = await renderAddressHarness()
  try {
    await waitFor(() =>
      expect(rendered.harness.workspace.getState().rootFolder?.workspaceAddress).toEqual(target),
    )
    await flushProjection()
    expect(editorTabPaths(rendered.harness.workspace)).toEqual(['projects/platform/shared.ts'])
    expect(location.pathname).toBe(`/~${workspaceToken(target)}/workbench/f/shared.ts`)
  } finally {
    rendered.unmount()
    rendered.application.dispose()
    restoreEnvironment()
  }
})

test('an alias shares the canonical workspace ID and restores files under the canonical root', async ({
  client,
  server,
}) => {
  await mkdir(path.join(server.root, 'projects/platform'), { recursive: true })
  await writeFile(
    path.join(server.root, 'projects/platform/shared.ts'),
    'export const shared = 1\n',
  )
  await symlink('projects/platform', path.join(server.root, 'shortcut'), 'dir')
  const canonical = await registerTestWorkspaceAddress(client, 'projects/platform')
  const alias = await registerTestWorkspaceAddress(client, 'shortcut')
  expect(alias).toEqual(canonical)
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const restoreEnvironment = scopeAddressEnvironment(
    'http://localhost:37903',
    descriptor.environmentId,
    client,
  )
  localStorage.clear()
  startAt(`/~${workspaceToken(alias)}/workbench/f/shared.ts`)
  const rendered = await renderAddressHarness()
  try {
    await waitFor(() =>
      expect(rendered.harness.workspace.getState().rootFolder).toMatchObject({
        path: 'projects/platform',
        workspaceAddress: canonical,
      }),
    )
    await flushProjection()
    expect(editorTabPaths(rendered.harness.workspace)).toEqual(['projects/platform/shared.ts'])
    expect(location.pathname).toBe(`/~${workspaceToken(canonical)}/workbench/f/shared.ts`)
  } finally {
    rendered.unmount()
    rendered.application.dispose()
    restoreEnvironment()
  }
})
