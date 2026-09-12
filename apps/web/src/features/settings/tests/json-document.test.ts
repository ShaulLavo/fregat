import { getClient } from '@/lib/client'
import { fetchSettings, saveSettingsText } from '@/features/settings/utils/api'
import { expect, test } from '../../../../test/fixtures'

test('the snapshot carries each layer bytes, so a JSON view needs no second fetch', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const before = await fetchSettings()
  await getClient().settings.raw.post({
    baseRevision: before.layers.find((layer) => layer.id === 'user')?.file?.revision ?? '',
    target: 'user',
    // A comment and an unregistered key: both have to survive, which is what
    // makes the raw view worth having over the form.
    text: '{\n  // why this is set\n  "editor.fontSize": 21,\n  "from.a.newer.build": true\n}\n',
    writeId: 'json-document-seed',
  })

  const snapshot = await fetchSettings()
  const file = snapshot.layers.find((layer) => layer.id === 'user')?.file

  expect(file?.text).toContain('// why this is set')
  expect(file?.text).toContain('"from.a.newer.build"')
  expect(file?.parseErrors).toEqual([])
  expect(file?.keyRanges['from.a.newer.build']).toEqual({ offset: 50, length: 20 })
  expect(file?.revision).not.toBe('')
})

test('a raw save round-trips through the same route the tab uses', async ({ client }) => {
  expect(client).toBeDefined()
  const before = await fetchSettings()
  const revision = before.layers.find((layer) => layer.id === 'user')?.file?.revision ?? ''

  const after = await saveSettingsText({
    baseRevision: revision,
    target: 'user',
    text: '{ "editor.fontSize": 19 }\n',
    writeId: 'json-document-round-trip',
  })

  expect(after.snapshot.values['editor.fontSize']).toBe(19)
  expect(after.snapshot.layers.find((layer) => layer.id === 'user')?.file?.text).toBe(
    '{ "editor.fontSize": 19 }\n',
  )
})

// The buffer seeds from a revision, and the next save guards on it. A save that
// did not advance it would refuse every subsequent save of the same tab.
test('a stale base revision is refused rather than overwriting', async ({ client }) => {
  expect(client).toBeDefined()
  const before = await fetchSettings()
  const stale = before.layers.find((layer) => layer.id === 'user')?.file?.revision ?? ''

  await saveSettingsText({
    baseRevision: stale,
    target: 'user',
    text: '{ "editor.fontSize": 17 }\n',
    writeId: 'json-document-first-stale-test-write',
  })

  await expect(
    saveSettingsText({
      baseRevision: stale,
      target: 'user',
      text: '{ "editor.fontSize": 18 }\n',
      writeId: 'json-document-stale-write',
    }),
  ).rejects.toThrow()

  const after = await fetchSettings()
  expect(after.values['editor.fontSize']).toBe(17)
})
