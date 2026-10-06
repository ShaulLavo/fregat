import { settingsDiffAttachment } from '@/lib/diff-attachment'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { documentKey, settingsJsonDocument, filesystemPath } from '@/lib/documents/utils/identity'
import { fetchSettings, saveSettingsText } from '@/features/settings/utils/api'
import { SettingsSyncService } from '@/features/settings/state/sync-service'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { makeTestServer } from '../../../../test/server'
import { createInProcessClient } from '../../../../test/client'
import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { expect, test } from '../../../../test/fixtures'

const key = documentKey(settingsJsonDocument('user'))

test('actual confirmed conflict calibrates current local text and rejects a confirmed-only observer', async ({
  client,
}) => {
  const f = await createAddressTestRuntime(client)
  const initial = await fetchSettings(undefined, client)
  const file = initial.layers.find((layer) => layer.id === 'user')?.file
  if (!file) throw new RangeError('Actual user settings file required')
  const document = f.editor.documentStore
    .getState()
    .ensureSettingsDocument(settingsJsonDocument('user'), {
      content: file.text,
      revision: file.revision,
    })
  createEditorBufferSession(document.buffer).applyText(' ')
  const external = await saveSettingsText(
    {
      target: 'user',
      text: '{ "editor.fontSize": 23 }\n',
      baseRevision: file.revision,
      writeId: 'settings-comparison-calibration',
    },
    client,
  )
  expect(
    await new SettingsSyncService(
      f.editor.documentStore,
      f.application.getSnapshot().queryClient,
    ).save(document),
  ).toBe(false)
  const current = f.editor.documentStore.getState().getLiveEditorDocument(key)
  if (!current || current.sync.kind !== 'settings' || current.sync.state !== 'conflict')
    throw new RangeError('Actual settings conflict required')
  expect(current.buffer).toBe(document.buffer)
  expect(current.sync.confirmedText).toBe(
    external.snapshot.layers.find((layer) => layer.id === 'user')?.file?.text,
  )
  expect(() =>
    expect(current.buffer.materializeFullText()).toBe(
      current.sync.kind === 'settings' && current.sync.state === 'conflict'
        ? current.sync.confirmedText
        : null,
    ),
  ).toThrow()
})

test('Compare owns actual moving committed local and a whole confirmed reader with independent interests', async ({
  client,
}) => {
  const f = await createAddressTestRuntime(client)
  const initial = await fetchSettings(undefined, client)
  const file = initial.layers.find((layer) => layer.id === 'user')?.file
  if (!file) throw new RangeError('Actual user settings file required')
  const documents = f.editor.documentStore.getState()
  const document = documents.ensureSettingsDocument(settingsJsonDocument('user'), {
    content: file.text,
    revision: file.revision,
  })
  const editing = createEditorBufferSession(document.buffer)
  editing.applyText(' ')
  const external = await saveSettingsText(
    {
      target: 'user',
      text: '{ "editor.fontSize": 24 }\n',
      baseRevision: file.revision,
      writeId: 'settings-comparison-external',
    },
    client,
  )
  const confirmed = external.snapshot.layers.find((layer) => layer.id === 'user')?.file
  if (!confirmed) throw new RangeError('Actual confirmed file required')
  expect(
    await new SettingsSyncService(
      f.editor.documentStore,
      f.application.getSnapshot().queryClient,
    ).save(document),
  ).toBe(false)
  const scope = { environmentId: f.environmentId, rootPath: filesystemPath('') }
  const firstAbort = new AbortController()
  const first = documents.acquireSettingsComparison({ scope, key, signal: firstAbort.signal })
  const second = documents.acquireSettingsComparison({
    scope,
    key,
    signal: new AbortController().signal,
  })
  const before = first.read()
  if (
    before.kind !== 'ready' ||
    before.input.kind !== 'settings' ||
    before.input.confirmed.kind !== 'confirmed'
  )
    throw new RangeError('Actual admitted settings comparison required')
  expect(before).toBe(second.read())
  expect(before.input.local.buffer).toBe(document.buffer)
  expect(before.input.local.snapshot).toBe(document.buffer.getTextSnapshot())
  expect(before.input.confirmed.revision).toBe(confirmed.revision)
  expect(before.input.confirmed.reader.materializeFullText()).toBe(confirmed.text)
  editing.applyText(' ')
  const moved = first.read()
  if (moved.kind !== 'ready' || moved.input.kind !== 'settings')
    throw new RangeError('Committed settings read required')
  expect(moved.input.local.revision).toBe(document.buffer.getRevision())
  expect(moved.input.local.snapshot).toBe(document.buffer.getTextSnapshot())
  expect(moved.input.confirmed).toBe(before.input.confirmed)
  expect(before.input.local.snapshot.materializeFullText()).not.toBe(
    moved.input.local.snapshot.materializeFullText(),
  )
  firstAbort.abort()
  expect(first.read().kind).toBe('released')
  expect(second.read().kind).toBe('ready')
  second.release()
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
})

test('confirmed pending and restored pairs never use cached text as a new confirmation', async ({
  client,
}) => {
  const f = await createAddressTestRuntime(client)
  const initial = await fetchSettings(undefined, client)
  const file = initial.layers.find((layer) => layer.id === 'user')?.file
  if (!file) throw new RangeError('Actual user file required')
  const docs = f.editor.documentStore.getState()
  docs.ensureSettingsDocument(settingsJsonDocument('user'), {
    content: file.text,
    revision: file.revision,
  })
  docs.markSettingsDocumentConflict(key, file.text, file.revision)
  const lease = docs.acquireSettingsComparison({
    key,
    scope: { environmentId: f.environmentId, rootPath: filesystemPath('') },
    signal: new AbortController().signal,
  })
  const first = lease.read()
  if (
    first.kind !== 'ready' ||
    first.input.kind !== 'settings' ||
    first.input.confirmed.kind !== 'confirmed'
  )
    throw new RangeError('Actual confirmed read required')
  docs.markSettingsDocumentConflict(key, file.text, null)
  const pending = lease.read()
  if (pending.kind !== 'ready' || pending.input.kind !== 'settings')
    throw new RangeError('Actual pending read required')
  expect(pending.input.confirmed).toEqual({ kind: 'pending' })
  expect(settingsDiffAttachment(pending)).toBeNull()
  expect(first.input.confirmed.reader.materializeFullText()).toBe(file.text)
  docs.markSettingsDocumentConflict(key, null, file.revision)
  const missingText = lease.read()
  if (missingText.kind !== 'ready' || missingText.input.kind !== 'settings')
    throw new RangeError('Missing confirmation text must retain the actual settings read')
  expect(missingText.input.confirmed).toEqual({ kind: 'pending' })
  expect(settingsDiffAttachment(missingText)).toBeNull()
  const external = await saveSettingsText(
    {
      target: 'user',
      text: '{ "editor.fontSize": 25 }\n',
      baseRevision: file.revision,
      writeId: 'confirmed-pair-advance',
    },
    client,
  )
  const confirmed = external.snapshot.layers.find((layer) => layer.id === 'user')?.file
  if (!confirmed) throw new RangeError('Actual advanced confirmation required')
  docs.markSettingsDocumentConflict(key, confirmed.text, confirmed.revision)
  const next = lease.read()
  if (
    next.kind !== 'ready' ||
    next.input.kind !== 'settings' ||
    next.input.confirmed.kind !== 'confirmed'
  )
    throw new RangeError('Actual restored read required')
  expect(next.input.confirmed.revision).toBe(confirmed.revision)
  expect(next.input.confirmed.reader.materializeFullText()).toBe(confirmed.text)
  expect(next.input.confirmed.reader).not.toBe(first.input.confirmed.reader)
  expect(() =>
    docs.acquireSnapshotComparison({ input: first.input, signal: new AbortController().signal }),
  ).toThrow()
  expect(lease.refresh(first.input, lease.requestRefresh())).toBe(false)
  lease.release()
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
})

test('same-text replacement ends the former buffer and canceled or disposed owners cannot revive it', async ({
  client,
}) => {
  const f = await createAddressTestRuntime(client)
  const initial = await fetchSettings(undefined, client)
  const file = initial.layers.find((layer) => layer.id === 'user')?.file
  if (!file) throw new RangeError('Actual user file required')
  const docs = f.editor.documentStore.getState()
  const original = docs.ensureSettingsDocument(settingsJsonDocument('user'), {
    content: file.text,
    revision: file.revision,
  })
  docs.markSettingsDocumentConflict(key, file.text, file.revision)
  const scope = { environmentId: f.environmentId, rootPath: filesystemPath('') }
  const old = docs.acquireSettingsComparison({ key, scope, signal: new AbortController().signal })
  const read = old.read()
  if (read.kind !== 'ready' || read.input.kind !== 'settings')
    throw new RangeError('Actual old read required')
  expect(docs.reloadSettingsDocument(key)).toBe(true)
  const replacement = docs.getLiveEditorDocument(key)
  expect(replacement?.buffer).not.toBe(original.buffer)
  expect(replacement?.buffer.materializeFullText()).toBe(original.buffer.materializeFullText())
  expect(old.read().kind).toBe('released')
  expect(old.refresh(read.input, old.requestRefresh())).toBe(false)
  docs.markSettingsDocumentConflict(key, file.text, file.revision)
  const current = docs.acquireSettingsComparison({
    key,
    scope,
    signal: new AbortController().signal,
  })
  expect(current.read().kind).toBe('ready')
  expect(() =>
    docs.acquireSettingsComparison({
      key: documentKey(settingsJsonDocument('workspace')),
      scope,
      signal: new AbortController().signal,
    }),
  ).toThrow()
  const abort = new AbortController()
  abort.abort()
  const canceled = docs.acquireSettingsComparison({ key, scope, signal: abort.signal })
  expect(canceled.read().kind).toBe('released')
  docs.disposeEditorDocuments()
  expect(current.read()).toEqual({ kind: 'released', reason: 'owner-disposed' })
  expect(
    docs.acquireSettingsComparison({ key, scope, signal: new AbortController().signal }).read()
      .kind,
  ).toBe('released')
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
})

test('another real environment is refused and acquisition publication cancellation stays terminal', async ({
  client,
}) => {
  const f = await createAddressTestRuntime(client)
  const initial = await fetchSettings(undefined, client)
  const file = initial.layers.find((layer) => layer.id === 'user')?.file
  if (!file) throw new RangeError('Actual user file required')
  const docs = f.editor.documentStore.getState()
  docs.ensureSettingsDocument(settingsJsonDocument('user'), {
    content: file.text,
    revision: file.revision,
  })
  docs.markSettingsDocumentConflict(key, file.text, file.revision)
  const foreign = await makeTestServer()
  try {
    const descriptor = v.parse(
      healthDescriptorSchema,
      (await createInProcessClient(foreign).health.get()).data,
    )
    expect(descriptor.environmentId).not.toBe(f.environmentId)
    expect(() =>
      docs.acquireSettingsComparison({
        key,
        scope: { environmentId: descriptor.environmentId, rootPath: filesystemPath('') },
        signal: new AbortController().signal,
      }),
    ).toThrow('different environment')
    expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
  } finally {
    await foreign.cleanup()
  }
  const abort = new AbortController()
  const stop = f.editor.documentStore.subscribe((state) => {
    if (state.snapshotComparisons.size > 0) abort.abort()
  })
  const scope = { environmentId: f.environmentId, rootPath: filesystemPath('') }
  const canceled = docs.acquireSettingsComparison({ key, scope, signal: abort.signal })
  stop()
  expect(canceled.read()).toEqual({ kind: 'released', reason: 'interest-ended' })
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
  const current = docs.acquireSettingsComparison({
    key,
    scope,
    signal: new AbortController().signal,
  })
  expect(current.read().kind).toBe('ready')
  canceled.release()
  expect(current.read().kind).toBe('ready')
  current.release()
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
})

test('nested actual commits publish each event snapshot with its own revision and keep Undo', async ({
  client,
}) => {
  const f = await createAddressTestRuntime(client)
  const initial = await fetchSettings(undefined, client)
  const file = initial.layers.find((layer) => layer.id === 'user')?.file
  if (!file) throw new RangeError('Actual user file required')
  const docs = f.editor.documentStore.getState()
  const document = docs.ensureSettingsDocument(settingsJsonDocument('user'), {
    content: file.text,
    revision: file.revision,
  })
  docs.markSettingsDocumentConflict(key, file.text, file.revision)
  const lease = docs.acquireSettingsComparison({
    key,
    scope: { environmentId: f.environmentId, rootPath: filesystemPath('') },
    signal: new AbortController().signal,
  })
  const editing = createEditorBufferSession(document.buffer)
  const seen: { revision: number; text: string }[] = []
  let nested = false
  const stop = f.editor.documentStore.subscribe(() => {
    const read = lease.read()
    if (read.kind !== 'ready' || read.input.kind !== 'settings') return
    seen.push({
      revision: read.input.local.revision,
      text: read.input.local.snapshot.materializeFullText(),
    })
    if (nested) return
    nested = true
    editing.applyText('  ')
  })
  try {
    editing.applyText(' ')
    expect(seen).toContainEqual({ revision: 1, text: ' ' + file.text })
    expect(seen).toContainEqual({ revision: 2, text: '   ' + file.text })
    const current = lease.read()
    if (current.kind !== 'ready' || current.input.kind !== 'settings')
      throw new RangeError('Current event read required')
    expect(current.input.local.revision).toBe(2)
    expect(current.input.local.snapshot).toBe(document.buffer.getTextSnapshot())
    editing.undo()
    expect(document.buffer.materializeFullText()).toBe(file.text)
  } finally {
    stop()
    lease.release()
  }
})
