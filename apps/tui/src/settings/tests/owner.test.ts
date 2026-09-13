import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { writeSettings, writeSettingsText } from '@workspace/client-core/settings/write'

import { test, expect } from '../../../test/fixtures'
import { createControlledInProcessTransport, createInProcessClient } from '../../../test/client'
import { makeSettingsOwner } from '../../../test/factories/settings-owner'
import { makeTestServer } from '../../../test/server'
import { createTestSettingsSession } from '../../../test/factories/session'
import { saveSettingDraft } from '@/settings/utils/edit'

test('semantic writes project immediately and only confirmed settings enter the mirror', async ({
  server,
}) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: server.clientOrigin }),
  })
  const owner = await makeSettingsOwner(client)
  const before = owner.readSettingsMirror()['editor.fontSize']
  const gate = transport.pauseNextResponse('/settings/write')
  try {
    const result = owner.submit('user', [{ kind: 'set', key: 'editor.fontSize', value: 21 }])
    expect(owner.getSnapshot().projection.values['editor.fontSize']).toBe(21)
    expect(owner.readSettingsMirror()['editor.fontSize']).toBe(before)
    await gate.reached
    gate.release()
    expect(result.kind).toBe('submitted')
    if (result.kind === 'submitted') expect(await result.settled).toBe('acknowledged')
    expect(owner.readSettingsMirror()['editor.fontSize']).toBe(21)
  } finally {
    gate.release()
    owner.dispose()
  }
})

test('live stream updates the mirror from another client and owners stay isolated', async ({
  client,
}) => {
  const owner = await makeSettingsOwner(client)
  const otherServer = await makeTestServer()
  const otherOwner = await makeSettingsOwner(createInProcessClient(otherServer))
  const previous = otherOwner.readSettingsMirror()['editor.fontSize']
  try {
    owner.start()
    await writeSettings({
      client,
      request: {
        mutationId: 'external-settings-write',
        target: 'user',
        operations: [{ kind: 'set', key: 'editor.fontSize', value: 23 }],
      },
    })
    await expect.poll(() => owner.readSettingsMirror()['editor.fontSize']).toBe(23)
    expect(otherOwner.readSettingsMirror()['editor.fontSize']).toBe(previous)
  } finally {
    owner.dispose()
    otherOwner.dispose()
    await otherServer.cleanup()
  }
})

test('rejected workspace execution settings roll back and remain discardable', async ({
  client,
}) => {
  const owner = await makeSettingsOwner(client)
  const previous = owner.readSettingsMirror()['lsp.idleTimeoutMs']
  try {
    const result = owner.submit('workspace', [{ kind: 'set', key: 'lsp.idleTimeoutMs', value: 30 }])
    if (result.kind === 'submitted') expect(await result.settled).toBe('failed')
    expect(owner.getSnapshot().projection.values['lsp.idleTimeoutMs']).toBe(previous)
    const failure = owner.getSnapshot().failures[0]
    expect(failure).toBeDefined()
    if (failure) owner.discard(failure.intentId)
    expect(owner.getSnapshot().failures).toHaveLength(0)
  } finally {
    owner.dispose()
  }
})

test('collection edits use semantic operations and advanced records reject stale revisions', async ({
  client,
}) => {
  const owner = await makeSettingsOwner(client)
  try {
    const snapshot = owner.getSnapshot().snapshot
    expect(
      await saveSettingDraft({
        id: 'keybindings.overrides',
        draft: '{"workspace.showSettings":"F8"}',
        snapshot,
        owner,
        target: 'user',
      }),
    ).toBe('acknowledged')
    expect(owner.readSettingsMirror()['keybindings.overrides']).toEqual({
      'workspace.showSettings': 'F8',
    })
    const current = owner.getSnapshot().snapshot
    const layer = current.layers.find((entry) => entry.id === 'user')
    await writeSettingsText({
      client,
      request: {
        writeId: 'outside-raw-change',
        target: 'user',
        baseRevision: layer?.file?.revision ?? '',
        text: JSON.stringify({ ...layer?.raw, 'editor.fontSize': 25 }),
      },
    })
    await expect(
      saveSettingDraft({
        id: 'lsp.servers',
        draft: '{}',
        snapshot: current,
        owner,
        target: 'user',
      }),
    ).rejects.toBeDefined()
    await owner.refresh()
    expect(owner.readSettingsMirror()['editor.fontSize']).toBe(25)
  } finally {
    owner.dispose()
  }
})

test('editing one collection entry preserves another client’s changes to other entries', async ({
  client,
}) => {
  const owner = await makeSettingsOwner(client)
  try {
    const initial = owner.submit('user', [
      { kind: 'keybinding.set', command: 'workspace.showSettings', keys: 'F8' },
      { kind: 'keybinding.set', command: 'workspace.showQuickAccess', keys: 'F9' },
    ])
    if (initial.kind === 'submitted') await initial.settled
    const base = owner.getSnapshot().snapshot
    await writeSettings({
      client,
      request: {
        mutationId: 'other-entry-change',
        target: 'user',
        operations: [{ kind: 'keybinding.set', command: 'workspace.showQuickAccess', keys: 'F10' }],
      },
    })
    await saveSettingDraft({
      id: 'keybindings.overrides',
      draft: JSON.stringify({
        'workspace.showSettings': 'F7',
        'workspace.showQuickAccess': 'F9',
      }),
      snapshot: base,
      owner,
      target: 'user',
    })
    expect(owner.readSettingsMirror()['keybindings.overrides']).toEqual({
      'workspace.showSettings': 'F7',
      'workspace.showQuickAccess': 'F10',
    })
  } finally {
    owner.dispose()
  }
})

test('pausing cancels local projection and keeps confirmed settings after another process replaces the server', async ({
  server,
}) => {
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: server.clientOrigin }),
  })
  const owner = await makeSettingsOwner(client)
  const confirmed = owner.readSettingsMirror()['editor.fontSize']
  const gate = transport.pauseNextResponse('/settings/write')
  try {
    const pending = owner.submit('user', [{ kind: 'set', key: 'editor.fontSize', value: 22 }])
    await gate.reached
    owner.start()
    owner.pause()
    expect(owner.getSnapshot().projection.values['editor.fontSize']).toBe(confirmed)
    if (pending.kind === 'submitted') expect(await pending.settled).toBe('discarded')
    gate.release()
    await server.restart()
    await writeSettings({
      client,
      request: {
        mutationId: 'replacement-process-settings',
        target: 'user',
        operations: [{ kind: 'set', key: 'editor.fontSize', value: 29 }],
      },
    })
    await expect(owner.refresh()).rejects.toBeDefined()
    expect(owner.readSettingsMirror()['editor.fontSize']).toBe(confirmed)
    expect(owner.getSnapshot().pendingCount).toBe(0)
  } finally {
    gate.release()
    owner.dispose()
  }
})

test('an RPC drop pauses settings before a replacement endpoint can update cached values', async ({
  server,
}) => {
  const replacement = await makeTestServer()
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: server.clientOrigin }),
  })
  const session = createTestSettingsSession(server, {
    client,
    createSocket: transport.createSocket,
  })
  try {
    await session.refresh()
    const initial = session.getSnapshot()
    expect(initial.kind).toBe('ready')
    if (initial.kind !== 'ready') return
    const confirmed = initial.owner.readSettingsMirror()
    transport.sockets[0].serverClose({ code: 1006, wasClean: false })
    transport.connect(replacement)
    await writeSettings({
      client: createInProcessClient(replacement),
      request: {
        mutationId: 'replacement-endpoint-change',
        target: 'user',
        operations: [{ kind: 'set', key: 'editor.fontSize', value: 28 }],
      },
    })
    await expect(initial.owner.refresh()).rejects.toBeDefined()
    expect(session.getSnapshot()).toMatchObject({ kind: 'ready', connection: { kind: 'offline' } })
    expect(initial.owner.readSettingsMirror()).toBe(confirmed)
    expect(initial.owner.getSnapshot().projection.values).toBe(confirmed)
  } finally {
    session.dispose()
    await replacement.cleanup()
  }
})
