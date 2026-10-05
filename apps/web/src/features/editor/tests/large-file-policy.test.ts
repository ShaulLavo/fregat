import { expect, test } from '../../../../test/fixtures'
import { documentFeatureTier, MI_CODE_UNITS } from '@/features/editor/utils/large-file-policy'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { testDocumentKey } from '../../../../test/factories/document-targets'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { createPlatformFileOpenPreparer } from '@/features/editor/utils/prepared-document'

test('analysis and minimap have independent inclusive UTF-16 bounds', () => {
  expect(documentFeatureTier(20 * MI_CODE_UNITS, 20, 50)).toBe(3)
  expect(documentFeatureTier(20 * MI_CODE_UNITS + 1, 20, 50)).toBe(2)
  expect(documentFeatureTier(50 * MI_CODE_UNITS, 20, 50)).toBe(2)
  expect(documentFeatureTier(50 * MI_CODE_UNITS + 1, 20, 50)).toBe(0)
  expect(documentFeatureTier('😀'.length, 1 / MI_CODE_UNITS, 2 / MI_CODE_UNITS)).toBe(2)
  expect(documentFeatureTier(2, 3 / MI_CODE_UNITS, 1 / MI_CODE_UNITS)).toBe(1)
})

test('preparation and reconfiguration remove full-document stages above the live budget', async () => {
  const buffer = createEditorTextBuffer('const x = 1')
  const environment = {
    appliedThemeContentHash: null,
    appliedThemeId: null,
    selectedThemeId: 'dark',
    syntaxHighlightingEnabled: true,
    analysisLimitMiCodeUnits: 10,
    tabSize: 4,
  }
  const normal = createPlatformFileOpenPreparer(environment)
  const limited = createPlatformFileOpenPreparer({ ...environment, analysisLimitMiCodeUnits: 0 })
  const abort = new AbortController()
  const prepared = normal.prepare(
    buffer,
    testDocumentKey('a'),
    filesystemPath('a.ts'),
    abort.signal,
    { startIndex: 0, endIndex: 11 },
    createEditorDocumentAnalysis({ buffer, documentId: testDocumentKey('a') }),
  )
  expect(prepared.stages.length).toBeGreaterThan(0)
  const changed = limited.reconfigure(
    prepared.preparedDocument,
    buffer,
    testDocumentKey('a'),
    filesystemPath('a.ts'),
    abort.signal,
    { startIndex: 0, endIndex: 11 },
  )
  expect(changed.stages).toEqual([])
  expect(changed.documentConfigurationTag).not.toEqual(prepared.documentConfigurationTag)
  expect(limited.environment.configurationTag).not.toEqual(normal.environment.configurationTag)
  const fresh = limited.prepare(
    buffer,
    testDocumentKey('b'),
    filesystemPath('a.ts'),
    abort.signal,
    { startIndex: 0, endIndex: 11 },
    createEditorDocumentAnalysis({ buffer, documentId: testDocumentKey('b') }),
  )
  expect(fresh.stages).toEqual([])
  expect(await fresh.preparedDocument.fallbackReady).toBe(false)
  prepared.preparedDocument.dispose()
  fresh.preparedDocument.dispose()
})
