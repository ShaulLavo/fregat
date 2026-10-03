import { failingSettingsStream } from '../../../test/factories/settings-stream'
import { BUNDLED_THEMES } from '@workspace/contracts'
import { settingDraft } from '@/settings/utils/edit'
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

test('a stale binding deletion refreshes confirmed settings before its failure settles', async ({
  client,
}) => {
  const entries = [
    { keys: 'F6', command: null },
    { keys: 'F7', command: null },
    { keys: 'F7', command: null },
  ] as const
  for (const [index, entry] of entries.entries())
    await writeSettings({
      client,
      request: {
        mutationId: `owner-delete-seed-${index}`,
        target: 'user',
        operations: [{ kind: 'keybinding.append', entry }],
      },
    })
  const owner = await makeSettingsOwner(client)
  try {
    await writeSettings({
      client,
      request: {
        mutationId: 'owner-delete-other-client',
        target: 'user',
        operations: [{ kind: 'keybinding.delete', index: 0, expected: entries }],
      },
    })
    expect(owner.readSettingsMirror()['keybindings.overrides']).toEqual(entries)
    const submission = owner.submit('user', [
      { kind: 'keybinding.delete', index: 1, expected: entries },
    ])
    expect(submission.kind).toBe('submitted')
    if (submission.kind === 'submitted') expect(await submission.settled).toBe('failed')
    expect(owner.readSettingsMirror()['keybindings.overrides']).toEqual(entries.slice(1))
    expect(owner.getSnapshot().projection.values['keybindings.overrides']).toEqual(entries.slice(1))
    expect(owner.getSnapshot().pendingCount).toBe(0)
    expect(owner.getSnapshot().failures[0]?.error).toMatchObject({
      code: 'settings.KEYBINDINGS_STALE',
    })
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
        draft: '[{"keys":"F8","command":"workspace.showSettings"}]',
        snapshot,
        owner,
        target: 'user',
      }),
    ).toBe('acknowledged')
    expect(owner.readSettingsMirror()['keybindings.overrides']).toEqual([
      { keys: 'F8', command: 'workspace.showSettings' },
    ])
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

test('an outdated whole-list draft refuses to overwrite another client’s bindings', async ({
  client,
}) => {
  const owner = await makeSettingsOwner(client)
  try {
    const initial = owner.submit('user', [
      { kind: 'keybinding.set', command: 'workspace.showSettings', keys: ['F8'] },
      { kind: 'keybinding.set', command: 'workspace.showQuickAccess', keys: ['F9'] },
    ])
    if (initial.kind === 'submitted') await initial.settled
    const base = owner.getSnapshot().snapshot
    await writeSettings({
      client,
      request: {
        mutationId: 'other-entry-change',
        target: 'user',
        operations: [
          { kind: 'keybinding.set', command: 'workspace.showQuickAccess', keys: ['F10'] },
        ],
      },
    })
    await expect(
      saveSettingDraft({
        id: 'keybindings.overrides',
        draft: JSON.stringify([
          { keys: 'F7', command: 'workspace.showSettings' },
          { keys: 'F9', command: 'workspace.showQuickAccess' },
        ]),
        snapshot: base,
        owner,
        target: 'user',
      }),
    ).rejects.toMatchObject({ code: 'settings.RAW_REVISION_STALE' })
    await owner.refresh()
    expect(owner.readSettingsMirror()['keybindings.overrides']).toEqual([
      { keys: 'F8', command: 'workspace.showSettings' },
      { keys: 'F10', command: 'workspace.showQuickAccess' },
    ])
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

test('theme part drafts use the chosen variant', async ({ client }) => {
  const owner = await makeSettingsOwner(client)
  try {
    const bundle = BUNDLED_THEMES[1]!
    const saved = owner.submit('user', [
      { kind: 'set', key: 'workbench.theme', value: bundle },
      { kind: 'set', key: 'workbench.colorTheme', value: 'system' },
      {
        kind: 'theme.customize',
        id: bundle.id,
        mode: 'light',
        patch: { material: { opacity: 37 } },
      },
    ])
    if (saved.kind === 'submitted') await saved.settled
    const snapshot = owner.getSnapshot().snapshot
    expect(settingDraft('workbench.surface.opacity', snapshot, 'user', 'light')).toBe('37')
    expect(settingDraft('workbench.palette', snapshot, 'user', 'light')).toBe(
      JSON.stringify(bundle.variants.light.palette),
    )
    expect(settingDraft('workbench.surface.opacity', snapshot, 'user', 'dark')).toBe(
      String(bundle.variants.dark.material.opacity),
    )
  } finally {
    owner.dispose()
  }
})

test('saving a theme part at the theme value removes its override for that half', async ({
  client,
}) => {
  const owner = await makeSettingsOwner(client)
  try {
    const bundle = BUNDLED_THEMES[1]!
    const saved = owner.submit('user', [
      { kind: 'set', key: 'workbench.theme', value: bundle },
      {
        kind: 'theme.customize',
        id: bundle.id,
        mode: 'dark',
        patch: { material: { opacity: 37 } },
      },
      {
        kind: 'theme.customize',
        id: bundle.id,
        mode: 'light',
        patch: { material: { opacity: 41 } },
      },
    ])
    if (saved.kind === 'submitted') await saved.settled
    const outcome = await saveSettingDraft({
      id: 'workbench.surface.opacity',
      draft: String(bundle.variants.dark.material.opacity),
      snapshot: owner.getSnapshot().snapshot,
      target: 'user',
      owner,
      mode: 'dark',
    })
    expect(outcome).toBe('acknowledged')
    expect(owner.readSettingsMirror()['workbench.theme.customizations'][bundle.id]).toEqual({
      light: { material: { opacity: 41 } },
    })
  } finally {
    owner.dispose()
  }
})

test('refresh after stopped supervision restarts the stream and receives later writes', async ({
  server,
  client,
}) => {
  const transport = failingSettingsStream(server, 'unreadable')
  const owner = await makeSettingsOwner(transport.client)
  try {
    owner.start()
    await expect.poll(() => owner.getSnapshot().streamStop?.reason).toBe('unreadable')
    transport.recover()
    await owner.refresh()
    expect(owner.getSnapshot().streamStop).toBeNull()
    await writeSettings({
      client,
      request: {
        mutationId: 'after-owner-refresh',
        target: 'user',
        operations: [{ kind: 'set', key: 'editor.fontSize', value: 30 }],
      },
    })
    await expect.poll(() => owner.readSettingsMirror()['editor.fontSize']).toBe(30)
  } finally {
    owner.dispose()
  }
})

test('contextual writes settle the owner mirror before acknowledgement and preserve another context', async ({
  client,
}) => {
  const owner = await makeSettingsOwner(client)
  try {
    const initial = owner.submit('user', [
      { kind: 'keybinding.set', command: 'workspace.saveFile', keys: ['F6'], context: 'Workspace' },
    ])
    if (initial.kind === 'submitted') await initial.settled
    const edit = owner.submit('user', [
      {
        kind: 'keybinding.set',
        command: 'workspace.saveFile',
        keys: ['F7'],
        context: 'Editor',
        defaultKeys: ['Mod+S'],
      },
    ])
    if (edit.kind === 'submitted') expect(await edit.settled).toBe('acknowledged')
    expect(owner.readSettingsMirror()['keybindings.overrides']).toEqual([
      { keys: 'F6', command: 'workspace.saveFile', context: 'Workspace' },
      { keys: 'Mod+S', unbind: 'workspace.saveFile', context: 'Editor' },
      { keys: 'F7', command: 'workspace.saveFile', context: 'Editor' },
    ])
    const reset = owner.submit('user', [
      { kind: 'keybinding.remove', command: 'workspace.saveFile', context: 'Editor' },
    ])
    if (reset.kind === 'submitted') await reset.settled
    expect(owner.readSettingsMirror()['keybindings.overrides']).toEqual([
      { keys: 'F6', command: 'workspace.saveFile', context: 'Workspace' },
    ])
  } finally {
    owner.dispose()
  }
})
