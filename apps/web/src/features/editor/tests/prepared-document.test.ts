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

  const first = editorPreparedDocumentTags('/repo/file.ts', baseEnvironment, true)
  const second = editorPreparedDocumentTags(
    '/repo/file.ts',
    {
      ...baseEnvironment,
      appliedThemeContentHash: 'theme-content-v2',
    },
    true,
  )

  expect(first.highlighterConfigurationTag).not.toEqual(second.highlighterConfigurationTag)
  expect(first.highlighterConfigurationTag).toContain('theme-content-v1')
  expect(second.highlighterConfigurationTag).toContain('theme-content-v2')
})

test('Markdown preparation selects the structural color source for custom themes', () => {
  const environment = {
    appliedThemeContentHash: 'theme-content-v1',
    appliedThemeId: 'custom-dark',
    selectedThemeId: 'custom-dark',
    syntaxHighlightingEnabled: true,
  }
  expect(
    editorPreparedDocumentTags('/repo/file.md', environment, true).documentConfigurationTag,
  ).toEqual(['platform-editor', 'markdown', 'tree-sitter', true])
  expect(
    editorPreparedDocumentTags('/repo/file.mdx', environment, true).documentConfigurationTag,
  ).toEqual(['platform-editor', 'mdx', 'tree-sitter', true])
  expect(
    editorPreparedDocumentTags('/repo/file.ts', environment, true).documentConfigurationTag,
  ).toEqual(['platform-editor', 'typescript', 'shiki', true])
})
