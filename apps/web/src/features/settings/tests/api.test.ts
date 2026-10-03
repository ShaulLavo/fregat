import { getClient } from '@/lib/client'
import { createInProcessClient } from '../../../../test/client'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'

import { recordClientLog } from '../../../../test/factories/client-log'
import { expect, test } from '../../../../test/fixtures'
import { fetchSettings, saveSettings, saveSettingsText } from '@/features/settings/utils/api'

test('reads registry defaults from an untouched server', async ({ client }) => {
  expect(client).toBeDefined()

  const snapshot = await fetchSettings(undefined, getClient())

  expect(snapshot.values).toEqual(DEFAULT_SETTING_VALUES)
  expect(snapshot.layers.every((layer) => !layer.present)).toBe(true)
})

test('round-trips semantic operations through the real server', async ({ client }) => {
  expect(client).toBeDefined()

  const result = await saveSettings(
    {
      mutationId: 'api-round-trip',
      operations: [
        { key: 'workbench.colorTheme', kind: 'set', value: 'dark' },
        { command: 'workspace.saveFile', keys: ['mod+s'], kind: 'keybinding.set' },
      ],
      target: 'user',
    },
    getClient(),
  )

  expect(result.snapshot.values['workbench.colorTheme']).toBe('dark')
  expect(result.snapshot.values['keybindings.overrides']).toEqual([
    { keys: 'mod+s', command: 'workspace.saveFile' },
  ])
  expect((await fetchSettings(undefined, getClient())).values).toEqual(result.snapshot.values)
})

test('preserves date-shaped setting strings exactly as saved', async ({ client }) => {
  expect(client).toBeDefined()
  // An installed family may be named anything, including a date.
  const values = ['local:2026-09-05', 'local:2026-09-05T12:34:56+03:00']

  for (const [index, value] of values.entries()) {
    await saveSettings(
      {
        mutationId: `literal-string-${index}`,
        operations: [{ key: 'editor.fontFamily', kind: 'set', value }],
        target: 'user',
      },
      getClient(),
    )
    expect((await fetchSettings(undefined, getClient())).values['editor.fontFamily']).toBe(value)
  }
})

test('rejects a retained mutation id reused for another intent', async ({ client }) => {
  expect(client).toBeDefined()

  await saveSettings(
    {
      mutationId: 'api-id-collision',
      operations: [{ key: 'workbench.colorTheme', kind: 'set', value: 'dark' }],
      target: 'user',
    },
    getClient(),
  )

  await expect(
    saveSettings(
      {
        mutationId: 'api-id-collision',
        operations: [{ key: 'workbench.colorTheme', kind: 'set', value: 'light' }],
        target: 'user',
      },
      getClient(),
    ),
  ).rejects.toMatchObject({ code: 'settings.ID_COLLISION' })

  expect((await fetchSettings(undefined, getClient())).values['workbench.colorTheme']).toBe('dark')
})

test('round-trips a two-stroke shortcut through the real server', async ({ client }) => {
  expect(client).toBeDefined()
  const result = await saveSettings(
    {
      mutationId: 'api-chord-round-trip',
      operations: [
        { command: 'workspace.showSettings', keys: ['Mod+K Mod+S'], kind: 'keybinding.set' },
      ],
      target: 'user',
    },
    getClient(),
  )

  expect(result.snapshot.values['keybindings.overrides']).toEqual([
    { keys: 'Mod+K Mod+S', command: 'workspace.showSettings' },
  ])
  expect((await fetchSettings(undefined, getClient())).values).toEqual(result.snapshot.values)
})

test('rejects a third stroke before changing the settings document', async ({ client }) => {
  expect(client).toBeDefined()
  await expect(
    saveSettings(
      {
        mutationId: 'api-chord-too-long',
        operations: [
          {
            command: 'workspace.showSettings',
            keys: ['Mod+K Mod+S Mod+X'],
            kind: 'keybinding.set',
          },
        ],
        target: 'user',
      },
      getClient(),
    ),
  ).rejects.toMatchObject({ code: 'settings.WRITE_INVALID' })

  expect((await fetchSettings(undefined, getClient())).values['keybindings.overrides']).toEqual([])
})

test('refuses an application-scoped key written to workspace settings', async ({ client }) => {
  expect(client).toBeDefined()

  await expect(
    saveSettings(
      {
        mutationId: 'api-scope-rejection',
        operations: [
          {
            key: 'chat.defaultRuntimeMode',
            kind: 'set',
            value: 'approval-required',
          },
        ],
        target: 'workspace',
      },
      getClient(),
    ),
  ).rejects.toMatchObject({ code: 'settings.SCOPE_NOT_ALLOWED' })
})

test('raw telemetry distinguishes apply, duplicate acknowledgement, conflict, and rejection', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const info = recordClientLog('info')
  const warn = recordClientLog('warn')
  const before = await fetchSettings(undefined, getClient())
  const baseRevision = before.layers.find((layer) => layer.id === 'user')?.file?.revision ?? ''
  const request = {
    baseRevision,
    target: 'user' as const,
    text: '{ "editor.fontSize": 18 }\n',
    writeId: 'api-raw-telemetry',
  }

  await saveSettingsText(request, getClient())
  await saveSettingsText(request, getClient())
  await expect(
    saveSettingsText(
      {
        ...request,
        text: '{ "editor.fontSize": 19 }\n',
      },
      getClient(),
    ),
  ).rejects.toMatchObject({ code: 'settings.ID_COLLISION' })
  await expect(
    saveSettingsText(
      {
        ...request,
        text: '{ "editor.fontSize": 20 }\n',
        writeId: 'api-raw-stale',
      },
      getClient(),
    ),
  ).rejects.toMatchObject({ code: 'settings.RAW_REVISION_STALE' })

  const outcomes = (events: readonly Record<string, unknown>[]) => events.map((e) => e.outcome)
  expect(outcomes(info.events('settings.write-raw'))).toEqual(['applied', 'duplicate-ack'])
  expect(outcomes(warn.events('settings.write-raw'))).toEqual(['rejected', 'raw-conflict'])
})

test('contextual binding writes preserve other contexts, clear a preset pair and reset exactly that context', async ({
  client,
}) => {
  const write = (
    mutationId: string,
    operations: Parameters<typeof saveSettings>[0]['operations'],
  ) => saveSettings({ mutationId, operations, target: 'user' }, client)
  await write('context-root', [
    { kind: 'keybinding.set', command: 'workspace.saveFile', keys: ['F6'], context: 'Workspace' },
  ])
  const changed = await write('context-editor', [
    {
      kind: 'keybinding.set',
      command: 'workspace.saveFile',
      keys: ['F7'],
      context: 'Editor && writable',
      defaultKeys: ['Mod+S'],
    },
  ])
  expect(changed.snapshot.values['keybindings.overrides']).toEqual([
    { keys: 'F6', command: 'workspace.saveFile', context: 'Workspace' },
    { keys: 'Mod+S', unbind: 'workspace.saveFile', context: 'Editor && writable' },
    { keys: 'F7', command: 'workspace.saveFile', context: 'Editor && writable' },
  ])
  const cleared = await write('context-clear', [
    {
      kind: 'keybinding.set',
      command: 'workspace.saveFile',
      keys: null,
      context: 'Editor && writable',
      defaultKeys: ['Mod+S'],
    },
  ])
  expect(cleared.snapshot.values['keybindings.overrides']).toEqual([
    { keys: 'F6', command: 'workspace.saveFile', context: 'Workspace' },
    { keys: 'Mod+S', unbind: 'workspace.saveFile', context: 'Editor && writable' },
  ])
  const reset = await write('context-reset', [
    { kind: 'keybinding.remove', command: 'workspace.saveFile', context: 'Editor && writable' },
  ])
  expect(reset.snapshot.values['keybindings.overrides']).toEqual([
    { keys: 'F6', command: 'workspace.saveFile', context: 'Workspace' },
  ])
  const reserved = await write('context-reserve', [
    { kind: 'keybinding.append', entry: { keys: 'F8', command: null, context: 'Terminal' } },
  ])
  const deleted = await write('context-delete', [
    {
      kind: 'keybinding.delete',
      index: 0,
      expected: reserved.snapshot.values['keybindings.overrides'],
    },
  ])
  expect(deleted.snapshot.values['keybindings.overrides']).toEqual([
    { keys: 'F8', command: null, context: 'Terminal' },
  ])
})

test('rejects malformed context without a write', async ({ client }) => {
  const before = await fetchSettings(undefined, client)
  await expect(
    saveSettings(
      {
        mutationId: 'bad-context',
        target: 'user',
        operations: [
          {
            kind: 'keybinding.set',
            command: 'workspace.saveFile',
            keys: ['F8'],
            context: 'Editor &&',
          },
        ],
      },
      client,
    ),
  ).rejects.toMatchObject({ code: 'settings.WRITE_INVALID' })
  expect((await fetchSettings(undefined, client)).values).toEqual(before.values)
})

test('a duplicate append request acknowledges the same reservation once', async ({ client }) => {
  const request = {
    mutationId: 'reservation-idempotent',
    target: 'user',
    operations: [
      { kind: 'keybinding.append', entry: { keys: 'F8', command: null, context: 'Terminal' } },
    ],
  } as const
  const first = await saveSettings(request, client)
  const duplicate = await saveSettings(request, client)
  expect(first.duplicate).toBe(false)
  expect(duplicate.duplicate).toBe(true)
  expect(duplicate.snapshot.values['keybindings.overrides']).toEqual([
    { keys: 'F8', command: null, context: 'Terminal' },
  ])
})

test('a duplicate indexed delete request keeps the following entry', async ({ client }) => {
  await saveSettings(
    {
      mutationId: 'delete-first',
      target: 'user',
      operations: [{ kind: 'keybinding.append', entry: { keys: 'F8', command: null } }],
    },
    client,
  )
  await saveSettings(
    {
      mutationId: 'delete-second',
      target: 'user',
      operations: [{ kind: 'keybinding.append', entry: { keys: 'F9', command: null } }],
    },
    client,
  )
  const request = {
    mutationId: 'delete-idempotent',
    target: 'user',
    operations: [
      {
        kind: 'keybinding.delete',
        index: 0,
        expected: [
          { keys: 'F8', command: null },
          { keys: 'F9', command: null },
        ],
      },
    ],
  } as const
  await saveSettings(request, client)
  const duplicate = await saveSettings(request, client)
  expect(duplicate.duplicate).toBe(true)
  expect(duplicate.snapshot.values['keybindings.overrides']).toEqual([
    { keys: 'F9', command: null },
  ])
})

for (const [kind, keys] of [
  ['shifted binding', ['F6', 'F7', 'F8']],
  ['duplicate binding', ['F6', 'F7', 'F7']],
] as const)
  test(`a stale deletion from another client cannot delete a ${kind}`, async ({ server }) => {
    const firstClient = createInProcessClient(server)
    const secondClient = createInProcessClient(server)
    const observed = keys.map((key) => ({ keys: key, command: null }))
    for (const [index, entry] of observed.entries())
      await saveSettings(
        {
          mutationId: `stale-delete-seed-${index}`,
          target: 'user',
          operations: [{ kind: 'keybinding.append', entry }],
        },
        firstClient,
      )
    const firstView = await fetchSettings(undefined, firstClient)
    const secondView = await fetchSettings(undefined, secondClient)
    expect(firstView.values['keybindings.overrides']).toEqual(
      secondView.values['keybindings.overrides'],
    )
    await saveSettings(
      {
        mutationId: 'stale-delete-first-client',
        target: 'user',
        operations: [
          {
            kind: 'keybinding.delete',
            index: 0,
            expected: firstView.values['keybindings.overrides'],
          },
        ],
      },
      firstClient,
    )
    await expect(
      saveSettings(
        {
          mutationId: 'stale-delete-second-client',
          target: 'user',
          operations: [
            {
              kind: 'keybinding.delete',
              index: 1,
              expected: secondView.values['keybindings.overrides'],
            },
          ],
        },
        secondClient,
      ),
    ).rejects.toMatchObject({ code: 'settings.KEYBINDINGS_STALE' })
    expect((await fetchSettings(undefined, secondClient)).values['keybindings.overrides']).toEqual(
      observed.slice(1),
    )
  })
