import { afterAll } from 'vitest'

import {
  disposeEditorShikiWorkerOwner,
  disposeEditorTreeSitterSyntaxProvider,
  editorDiffSyntaxConfiguration,
  editorSyntaxHighlightingSource,
  editorShikiHighlighterProvider,
  editorTreeSitterSyntaxProvider,
} from '@/features/editor/state/syntax-highlighting'
import { expect, test } from '../../../../../test/fixtures'

afterAll(async () => {
  await disposeEditorShikiWorkerOwner()
  await disposeEditorTreeSitterSyntaxProvider()
})

test('diffs receive the same Shiki provider used by regular editors', () => {
  const configuration = editorDiffSyntaxConfiguration(editorSyntaxHighlightingSource('dark-plus'))

  expect(configuration.source).toBe('shiki')
  expect(configuration.backend.kind).toBe('highlighter')
  if (configuration.backend.kind !== 'highlighter') return

  expect(configuration.backend.provider).toBe(editorShikiHighlighterProvider())
})

test('diffs receive the same tree-sitter provider used by regular editors', () => {
  const configuration = editorDiffSyntaxConfiguration(
    editorSyntaxHighlightingSource('tree-sitter-dark'),
  )

  expect(configuration.source).toBe('tree-sitter')
  expect(configuration.backend.kind).toBe('tree-sitter')
  if (configuration.backend.kind !== 'tree-sitter') return

  expect(configuration.backend.provider).toBe(editorTreeSitterSyntaxProvider())
})
