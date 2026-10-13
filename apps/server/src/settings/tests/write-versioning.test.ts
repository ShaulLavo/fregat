import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SettingsEvent, SettingsMutationRequest } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../store'

const roots: string[] = []
const stores: SettingsStore[] = []

async function createStore(options: { receiptLimit?: number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'settings-versioning-'))
  roots.push(root)
  const store = new SettingsStore({
    receiptLimit: options.receiptLimit,
    secretsFilePath: path.join(root, 'secrets.json'),
    userFilePath: path.join(root, 'settings.json'),
    watch: false,
  })
  stores.push(store)

  return store
}

function setFontSize(mutationId: string, value: number): SettingsMutationRequest {
  return {
    mutationId,
    operations: [{ key: 'editor.fontSize', kind: 'set', value }],
    target: 'user',
  }
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('writes beside an invalid stored value', () => {
  it('saves an unrelated setting and leaves the invalid font available for repair', async () => {
    const store = await createStore()
    await store.writeRaw({
      target: 'user',
      baseRevision: '',
      writeId: 'plant-invalid-font',
      text: '{ "editor.fontFamily": "Fira Code" }\n',
    })

    const result = await store.write(setFontSize('unrelated-font-size', 23))

    expect(result.snapshot.values['editor.fontSize']).toBe(23)
    expect(result.changedSettingIds).toEqual(['editor.fontSize'])
    expect(JSON.parse(store.rawLayer('user').text)['editor.fontFamily']).toBe('Fira Code')
    expect(result.snapshot.diagnostics).toContainEqual(
      expect.objectContaining({ id: 'editor.fontFamily', kind: 'invalid-value', layer: 'user' }),
    )

    const repaired = await store.write({
      target: 'user',
      mutationId: 'reset-invalid-font',
      operations: [{ kind: 'reset', keys: ['editor.fontFamily'] }],
    })
    expect(repaired.snapshot.diagnostics).not.toContainEqual(
      expect.objectContaining({ id: 'editor.fontFamily', kind: 'invalid-value' }),
    )
    expect(JSON.parse(store.rawLayer('user').text)).toEqual({ 'editor.fontSize': 23 })
  })
})

describe('validation of changed settings', () => {
  it('rejects an invalid changed font without saving the other operation', async () => {
    const store = await createStore()
    await expect(
      store.write({
        target: 'user',
        mutationId: 'invalid-font-write',
        operations: [
          { kind: 'set', key: 'editor.fontSize', value: 23 },
          { kind: 'set', key: 'editor.fontFamily', value: 'Fira Code' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'settings.WRITE_INVALID' })
    expect(store.rawLayer('user').text).not.toContain('23')
    expect(store.snapshot().serverVersion.sequence).toBe(0)
  })
})

describe('versioned settings acknowledgements', () => {
  it('publishes one version and returns the same version over HTTP and SSE', async () => {
    const store = await createStore()
    const events: SettingsEvent[] = []
    store.onChange((event) => events.push(event))

    const result = await store.write(setFontSize('font-once', 21))

    expect(events).toHaveLength(1)
    expect(events[0]?.snapshot.serverVersion).toEqual(result.appliedVersion)
    expect(events[0]?.originMutationId).toBe('font-once')
    expect(events[0]?.changedSettingIds).toEqual(['editor.fontSize'])
    expect(result.snapshot.serverVersion.sequence).toBe(1)
  })

  it('acknowledges a retained duplicate with its original version and the current snapshot', async () => {
    const store = await createStore()
    const events: SettingsEvent[] = []
    store.onChange((event) => events.push(event))
    const request = setFontSize('font-retry', 22)
    const first = await store.write(request)
    await store.write({
      mutationId: 'line-height',
      operations: [{ key: 'editor.lineHeight', kind: 'set', value: 31 }],
      target: 'user',
    })

    const duplicate = await store.write(request)

    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.appliedVersion).toEqual(first.appliedVersion)
    expect(duplicate.snapshot.serverVersion.sequence).toBe(2)
    expect(duplicate.snapshot.values['editor.lineHeight']).toBe(31)
    expect(events).toHaveLength(2)
  })

  it('rejects a retained id with another semantic or malformed raw payload', async () => {
    const store = await createStore()
    await store.write(setFontSize('shared-semantic-id', 20))
    await expect(store.write(setFontSize('shared-semantic-id', 30))).rejects.toMatchObject({
      code: 'settings.ID_COLLISION',
    })

    const raw = {
      baseRevision: store.rawLayer('user').revision,
      target: 'user' as const,
      text: '{ "editor.fontSize": 24 }\n',
      writeId: 'shared-raw-id',
    }
    await store.writeRaw(raw)
    await expect(store.writeRaw({ ...raw, text: '{ this is not json' })).rejects.toMatchObject({
      code: 'settings.ID_COLLISION',
    })
  })

  it('bounds receipts and treats an evicted semantic retry as a no-op', async () => {
    const store = await createStore({ receiptLimit: 1 })
    const events: SettingsEvent[] = []
    store.onChange((event) => events.push(event))
    const request = setFontSize('evicted-semantic', 23)
    await store.write(request)
    await store.write({
      mutationId: 'receipt-evictor',
      operations: [{ key: 'editor.lineHeight', kind: 'set', value: 32 }],
      target: 'user',
    })

    const retried = await store.write(request)

    expect(retried.duplicate).toBe(false)
    expect(retried.snapshot.serverVersion.sequence).toBe(2)
    expect(events).toHaveLength(2)
  })

  it('acknowledges an evicted identical raw retry before its stale CAS check', async () => {
    const store = await createStore({ receiptLimit: 1 })
    const events: SettingsEvent[] = []
    store.onChange((event) => events.push(event))
    const request = {
      baseRevision: '',
      target: 'user' as const,
      text: '{ "editor.fontSize": 25 }\n',
      writeId: 'evicted-raw',
    }
    await store.writeRaw(request)
    await store.write(setFontSize('raw-receipt-evictor', 25))

    const retried = await store.writeRaw(request)

    expect(retried.duplicate).toBe(false)
    expect(retried.snapshot.serverVersion.sequence).toBe(1)
    expect(events).toHaveLength(1)
  })

  it('deduplicates an identical retained raw request without another event', async () => {
    const store = await createStore()
    const events: SettingsEvent[] = []
    store.onChange((event) => events.push(event))
    const request = {
      baseRevision: '',
      target: 'user' as const,
      text: '{ "editor.fontSize": 26 }\n',
      writeId: 'raw-retry',
    }
    const first = await store.writeRaw(request)

    const duplicate = await store.writeRaw(request)

    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.appliedVersion).toEqual(first.appliedVersion)
    expect(events).toHaveLength(1)
  })
})
