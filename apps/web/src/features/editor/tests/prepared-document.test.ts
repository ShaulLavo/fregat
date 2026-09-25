import { expect, test } from '../../../../test/fixtures'

import { editorPreparedDocumentTags } from '@/features/editor/utils/prepared-document'

test('resolved theme content participates in prepared Shiki identity', () => {
  const baseEnvironment = {
    appliedThemeContentHash: 'theme-content-v1',
    appliedThemeId: 'custom-dark',
    selectedThemeId: 'custom-dark',
    syntaxHighlightingEnabled: false,
    tabSize: 4,
  } as const

  const first = editorPreparedDocumentTags('/repo/file.ts', baseEnvironment)
  const second = editorPreparedDocumentTags('/repo/file.ts', {
    ...baseEnvironment,
    appliedThemeContentHash: 'theme-content-v2',
  })

  expect(first.highlighterConfigurationTag).not.toEqual(second.highlighterConfigurationTag)
  expect(first.highlighterConfigurationTag).toContain('theme-content-v1')
  expect(second.highlighterConfigurationTag).toContain('theme-content-v2')
})
