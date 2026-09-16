import { describe } from 'vitest'
import { expect, test as it } from '../../../../test/fixtures'
import {
  documentTargets,
  testDocumentKey,
  testDocumentRef,
  testTabContent,
} from '../../../../test/factories/document-targets'
import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import { settingsTab, tabDocuments } from '@/lib/documents/utils/tabs'
import { isEditorTabDirty } from '@/features/workspace/utils/tab-dirty'

describe('the documents behind a tab', () => {
  it.each([
    documentTargets.savedComparison,
    documentTargets.snapshot,
    documentTargets.checkpointFile,
    documentTargets.checkpointSession,
    documentTargets.checkpointTurn,
  ])('does not claim the working file through comparison %s', (path) => {
    const content = testTabContent(path)
    expect(tabDocuments(content)).toEqual([testDocumentRef(path)])
    expect(isEditorTabDirty(content, new Set([testDocumentKey('/repo/src/a.ts')]))).toBe(false)
  })

  it('keeps an editable reference buffer separate from its source file', () => {
    const content = testTabContent(documentTargets.reference)
    expect(tabDocuments(content)).toEqual([testDocumentRef(documentTargets.reference)])
    expect(isEditorTabDirty(content, new Set([testDocumentKey(documentTargets.reference)]))).toBe(
      true,
    )
    expect(isEditorTabDirty(content, new Set([testDocumentKey('/repo/src/a.ts')]))).toBe(false)
  })

  it('owns its ordinary file', () => {
    expect(tabDocuments(testTabContent('/repo/src/app.ts'))).toEqual([
      testDocumentRef('/repo/src/app.ts'),
    ])
  })

  it('owns exactly the three scope buffers for the settings tab', () => {
    expect(tabDocuments(settingsTab())).toEqual([
      settingsJsonDocument('user'),
      settingsJsonDocument('workspace'),
      settingsJsonDocument('default'),
    ])
  })
})

describe('tab dirtiness', () => {
  it('follows the file for an ordinary tab', () => {
    expect(
      isEditorTabDirty(testTabContent('/repo/a.ts'), new Set([testDocumentKey('/repo/a.ts')])),
    ).toBe(true)
    expect(
      isEditorTabDirty(testTabContent('/repo/a.ts'), new Set([testDocumentKey('/repo/b.ts')])),
    ).toBe(false)
  })

  it('reports the settings tab dirty from either scope buffer', () => {
    expect(
      isEditorTabDirty(settingsTab(), new Set([documentKey(settingsJsonDocument('user'))])),
    ).toBe(true)
    expect(
      isEditorTabDirty(settingsTab(), new Set([documentKey(settingsJsonDocument('workspace'))])),
    ).toBe(true)
    expect(isEditorTabDirty(settingsTab(), new Set())).toBe(false)
  })
})
