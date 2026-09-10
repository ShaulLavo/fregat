import { writeSettings } from '@workspace/client-core/settings/write'

import { createRawSettingsEditor } from '@/settings/state/raw-editor'
import { makeSettingsOwner } from '../../../test/factories/settings-owner'
import { test, expect } from '../../../test/fixtures'

test('raw editor keeps the exact draft and revision after a concurrent semantic write, then explicitly reloads', async ({
  client,
}) => {
  const owner = await makeSettingsOwner(client)
  const drafts: string[] = []
  const draft = '{"editor.fontSize":24}'
  const editor = createRawSettingsEditor({
    owner,
    target: 'user',
    editText: async ({ text }) => {
      drafts.push(text)
      if (drafts.length === 1)
        await writeSettings({
          client,
          request: {
            mutationId: 'external-before-raw-save',
            target: 'user',
            operations: [{ kind: 'set', key: 'editor.fontSize', value: 22 }],
          },
        })
      return draft
    },
  })
  const revision = editor.getSnapshot().revision
  try {
    await editor.edit()
    expect(editor.getSnapshot()).toMatchObject({ phase: 'failed', text: draft, revision })
    expect(editor.getSnapshot().error).toContain('Settings changed elsewhere')
    await editor.edit()
    expect(drafts[1]).toBe(draft)
    expect(editor.getSnapshot().phase).toBe('failed')
    await editor.edit(true)
    expect(JSON.parse(drafts[2])['editor.fontSize']).toBe(22)
    expect(editor.getSnapshot().phase).toBe('done')
    expect(owner.readSettingsMirror()['editor.fontSize']).toBe(24)
  } finally {
    editor.dispose()
    owner.dispose()
  }
})

test('invalid raw JSON remains editable and a disposed editor cannot submit its late result', async ({
  client,
}) => {
  const owner = await makeSettingsOwner(client)
  const edited = Promise.withResolvers<string>()
  let count = 0
  const editor = createRawSettingsEditor({
    owner,
    target: 'user',
    editText: async () => (++count === 1 ? '{broken' : edited.promise),
  })
  const before = owner.readSettingsMirror()['editor.fontSize']
  try {
    await editor.edit()
    expect(editor.getSnapshot()).toMatchObject({ phase: 'failed', text: '{broken' })
    const pending = editor.edit()
    editor.dispose()
    edited.resolve('{"editor.fontSize":35}')
    await pending
    await owner.refresh()
    expect(owner.readSettingsMirror()['editor.fontSize']).toBe(before)
  } finally {
    editor.dispose()
    owner.dispose()
  }
})
