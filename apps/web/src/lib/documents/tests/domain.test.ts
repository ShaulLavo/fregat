import { expect, test } from '../../../../test/fixtures'
import {
  filesystemPath,
  fileResource,
  fileDocument,
  documentKey,
  settingsJsonDocument,
  conflictId,
} from '@/lib/documents/utils/identity'
import {
  activeTabDocument,
  documentTab,
  retainedTabDocuments,
  sameTabContent,
  settingsTab,
  tabDocuments,
} from '@/lib/documents/utils/tabs'
import {
  backingResource,
  durableTab,
  filesystemResource,
  saveCapability,
} from '@/lib/documents/utils/capabilities'
import { decodeDocumentTarget } from '../../../../test/factories/document-target-codec'
import { tabLabel, tabTitle } from '@/lib/documents/utils/labels'
import type { DocumentRef } from '@/lib/documents/utils/types'
import { TEST_SESSION_ID } from '../../../../test/factories/chat'

const root = filesystemPath('/repo')
const resource = fileResource(filesystemPath('/repo/src/a.ts'))

test('document identity includes kind and does not interpret explicitly constructed filesystem paths', () => {
  const file = fileDocument(fileResource(filesystemPath('settings-json:user')))
  const settings = settingsJsonDocument('user')
  expect(documentKey(file)).not.toBe(documentKey(settings))
  expect(filesystemResource(file)?.path).toBe('settings-json:user')
  expect(saveCapability(file)).toEqual({
    kind: 'file',
    resource: { path: 'settings-json:user' },
  })
  expect(documentKey(fileDocument(resource))).toBe(documentKey(fileDocument({ ...resource })))
})

test('settings tab membership is fixed while active Save follows explicit UI selection', () => {
  const content = settingsTab()
  expect(tabDocuments(content)).toEqual([
    { kind: 'settings-json', target: 'user' },
    { kind: 'settings-json', target: 'workspace' },
    { kind: 'settings-json', target: 'default' },
  ])
  expect(activeTabDocument(content, { kind: 'form' })).toBeNull()
  expect(activeTabDocument(content, { kind: 'json', target: 'workspace' })).toEqual({
    kind: 'settings-json',
    target: 'workspace',
  })
  expect(activeTabDocument(content, { kind: 'json', target: 'user' })).toBe(
    tabDocuments(content)[0],
  )
})

test('a history tab retains its file without owning it', () => {
  const history = { kind: 'history', file: resource } as const
  const content = documentTab(history)
  expect(retainedTabDocuments(content)).toEqual([history, fileDocument(resource)])
  expect(backingResource(history)).toEqual({ kind: 'file', resource })
  expect(filesystemResource(history)).toBeNull()
  expect(saveCapability(history)).toEqual({ kind: 'none' })
})

test('comparison backing retention does not grant close or save ownership of its file', () => {
  const comparison = { kind: 'compare-saved', file: resource } as const
  const content = documentTab(comparison)
  expect(tabDocuments(content)).toEqual([comparison])
  expect(retainedTabDocuments(content)).toEqual([comparison, fileDocument(resource)])
  expect(backingResource(comparison)).toEqual({ kind: 'file', resource })
  expect(filesystemResource(comparison)).toBeNull()
  expect(saveCapability(comparison)).toEqual({ kind: 'none' })
})

test('every unsavable document remains distinct from a filesystem destination', () => {
  const documents: readonly DocumentRef[] = [
    { kind: 'git-ref', source: { path: resource.path, ref: 'HEAD' } },
    {
      kind: 'git-diff',
      source: {
        kind: 'snapshot',
        path: resource.path,
        newObjectId: 'b'.repeat(40),
      },
    },
    { kind: 'compare-saved', file: resource },
    { kind: 'history', file: resource },
    {
      kind: 'conflict',
      conflictId: conflictId('missing'),
      path: resource.path,
    },
    { kind: 'search', root },
  ]
  for (const document of documents) {
    expect(saveCapability(document)).toEqual({ kind: 'none' })
    expect(filesystemResource(document)).toBeNull()
  }
})

for (const kind of ['checkpoint-session', 'checkpoint-turn'] as const) {
  test(`${kind} admission uses workspace ownership and no fabricated file`, () => {
    const document = {
      kind: 'git-diff',
      source: {
        kind,
        owner: root,
        sessionId: TEST_SESSION_ID,
        fromTurnCount: 0,
        toTurnCount: 2,
      },
    } as const
    const content = documentTab(document)
    expect(durableTab(content, root)).toBe(true)
    expect(durableTab(content, filesystemPath('/other'))).toBe(false)
    expect(durableTab(content, filesystemPath('/repo/nested'))).toBe(false)
    expect(backingResource(document)).toEqual({
      kind: 'git-diff',
      source: document.source,
    })
    expect('path' in document.source).toBe(false)
  })
}

test('empty root search is valid but empty conflict and compare identifiers are rejected', () => {
  const emptyRoot = filesystemPath('')
  expect(decodeDocumentTarget('search-buffer:', emptyRoot)).toEqual({
    kind: 'tab',
    content: { kind: 'document', document: { kind: 'search', root: '' } },
  })
  for (const value of [
    'compare-saved:',
    'conflict-diff:',
    'git-ref:',
    'git-diff:',
    'settings:bad',
    'settings-json:invalid',
  ]) {
    expect(decodeDocumentTarget(value, emptyRoot).kind).toBe('invalid')
  }
  expect(decodeDocumentTarget('settings-json:user', emptyRoot).kind).toBe('internal')
})

test('tab presentation uses typed content and preserves existing file path formatting', () => {
  const content = documentTab(fileDocument(resource))
  expect(tabLabel(content)).toBe('a.ts')
  expect(tabTitle(content)).toBe('//repo/src/a.ts')
  expect(sameTabContent(content, documentTab(fileDocument({ ...resource })))).toBe(true)
  expect(sameTabContent(content, settingsTab())).toBe(false)
  const conflict = documentTab({
    kind: 'conflict',
    conflictId: conflictId('missing'),
    path: resource.path,
  })
  expect(tabLabel(conflict)).toBe('a.ts')
  expect(tabTitle(conflict)).toBe('/repo/src/a.ts: Current Changes ↔ Incoming Changes')
})
