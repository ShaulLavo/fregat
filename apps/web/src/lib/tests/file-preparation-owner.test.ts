import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { QueryClient } from '@tanstack/react-query'
import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { ensureFileSnapshotQuery, fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { createPlatformFileOpenPreparer } from '@/features/editor/utils/prepared-document'
import { expect, test } from '../../../test/fixtures'
import { createGatedMutationClient } from '../../../test/factories/gated-mutation-client'
import {
  filePreparationOwner,
  preparationEnvironment,
  preparationRuntime,
} from '../../../test/factories/file-preparation'

test('independent caller release preserves a held shared query and survivor preparation', async ({
  server,
  onTestFinished,
}) => {
  const path = filesystemPath('repo/shared.ts')
  await mkdir(join(server.root, 'repo'))
  await writeFile(join(server.root, path), 'const shared = true\n')
  const transport = createGatedMutationClient(server, '/fs/read')
  const queryClient = new QueryClient()
  registerEnvironmentQueryClient(queryClient, server.origin, transport.client)
  const clock = preparationRuntime()
  const fixture = filePreparationOwner({ queryClient, runtime: clock.runtime })
  onTestFinished(() => {
    transport.release()
    fixture.dispose()
  })
  fixture.owner.setRoot(filesystemPath('repo'))
  fixture.owner.connect()
  const first = fixture.owner.service.prepare({ path, source: 'file-tree' })
  const second = fixture.owner.service.prepare({ path, source: 'quick-open' })
  clock.startNext()
  await transport.entered
  const sharedRead = ensureFileSnapshotQuery(queryClient, path)
  void sharedRead.catch(() => undefined)
  first.release()
  first.release()
  expect(queryClient.getQueryState(fileSnapshotQueryOptions(path).queryKey)?.fetchStatus).toBe(
    'fetching',
  )
  expect(
    transport.requests.filter((request) => new URL(request.url).pathname === '/fs/read'),
  ).toHaveLength(1)
  transport.release()
  await sharedRead
  await clock.settled()
  const claim = fixture.owner.service.claimLive(path)
  expect(claim).not.toBeNull()
  expect(claim?.preparedDocument).not.toBeNull()
  expect(claim?.buffer).toBe(fixture.documents.getLiveDocument(claim!.documentKey)?.buffer)
  fixture.documents.ensureViewForDocument(tabId('shared'), claim!.documentKey, claim)
  second.release()
  expect(fixture.documents.getViewDocument(tabId('shared'))?.preparedDocument).toBe(
    claim?.preparedDocument,
  )
})

test('the existing caller deadline releases its held read without canceling the query', async ({
  server,
  onTestFinished,
}) => {
  const path = filesystemPath('repo/expired.ts')
  const next = filesystemPath('repo/next.ts')
  await mkdir(join(server.root, 'repo'))
  await writeFile(join(server.root, path), 'const expired = true\n')
  await writeFile(join(server.root, next), 'const next = true\n')
  const transport = createGatedMutationClient(server, '/fs/read')
  const queryClient = new QueryClient()
  registerEnvironmentQueryClient(queryClient, server.origin, transport.client)
  const clock = preparationRuntime()
  const fixture = filePreparationOwner({ queryClient, runtime: clock.runtime })
  onTestFinished(() => {
    transport.release()
    fixture.dispose()
  })
  fixture.owner.setRoot(filesystemPath('repo'))
  fixture.owner.connect()
  fixture.owner.service.prepare({ path, source: 'file-tree' })
  clock.startNext()
  await transport.entered
  const sharedRead = ensureFileSnapshotQuery(queryClient, path)
  void sharedRead.catch(() => undefined)
  clock.advance(30_000)
  await clock.settled()
  expect(queryClient.getQueryState(fileSnapshotQueryOptions(path).queryKey)?.fetchStatus).toBe(
    'fetching',
  )
  fixture.owner.service.prepare({ path: next, source: 'quick-open' })
  expect(clock.queued()).toBe(1)
  clock.startNext()
  await clock.settled()
  const nextClaim = fixture.owner.service.claimLive(next)
  expect(nextClaim).not.toBeNull()
  expect(nextClaim?.preparedDocument).not.toBeNull()
  nextClaim?.preparedDocument?.dispose()
  nextClaim?.release()
  transport.release()
  await sharedRead
  expect(fixture.owner.service.claimLive(path)).toBeNull()
})

test('preparation identity rotates only after actual producer transitions settle', async ({
  onTestFinished,
}) => {
  const fixture = filePreparationOwner()
  onTestFinished(fixture.dispose)
  const { owner } = fixture
  const observed: object[] = []
  const stop = owner.service.subscribePreparationIdentity(() =>
    observed.push(owner.service.getPreparationIdentity()),
  )
  const initial = owner.service.getPreparationIdentity()
  owner.setRoot(filesystemPath('/repo'))
  const root = owner.service.getPreparationIdentity()
  expect(root).not.toBe(initial)
  owner.setRoot(filesystemPath('/repo/./'))
  expect(owner.service.getPreparationIdentity()).toBe(root)
  owner.connect()
  const connected = owner.service.getPreparationIdentity()
  expect(connected).not.toBe(root)
  owner.connect()
  owner.setEnvironment(createPlatformFileOpenPreparer(preparationEnvironment))
  owner.setRelatedPrefetch(() => undefined)
  expect(owner.service.getPreparationIdentity()).toBe(connected)
  owner.setEnvironment(createPlatformFileOpenPreparer({ ...preparationEnvironment, tabSize: 8 }))
  const configured = owner.service.getPreparationIdentity()
  expect(configured).not.toBe(connected)
  owner.scheduleDisconnect()
  owner.connect()
  await Promise.resolve()
  expect(owner.service.getPreparationIdentity()).toBe(configured)
  owner.scheduleDisconnect()
  await Promise.resolve()
  const disconnected = owner.service.getPreparationIdentity()
  expect(disconnected).not.toBe(configured)
  owner.connect()
  expect(owner.service.getPreparationIdentity()).not.toBe(disconnected)
  expect(observed).toHaveLength(5)
  stop()
})
