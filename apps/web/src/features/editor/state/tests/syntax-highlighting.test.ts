import { afterAll } from 'vitest'

import {
  disposeEditorSyntaxHighlighting,
  editorDiffSyntax,
  editorHighlighterProvider,
  editorSyntaxColors,
  editorSyntaxProvider,
} from '@/features/editor/state/syntax-highlighting'
import { expect, test } from '../../../../../test/fixtures'

afterAll(async () => {
  await disposeEditorSyntaxHighlighting()
})

test('diffs under an imported theme borrow the highlighter regular editors register', () => {
  const colors = editorSyntaxColors('dark-plus')
  const syntax = editorDiffSyntax(colors)

  expect(colors).toBe('vscode')
  expect(syntax.theme).not.toBeNull()
  // One object per theme source and engine, so a recolor keeps the diff plugin.
  expect(editorDiffSyntax(colors).backend).toBe(syntax.backend)
  if (syntax.backend.kind === 'highlighter') {
    expect(syntax.backend.provider).toBe(editorHighlighterProvider())
  }
})

test('diffs under a built-in palette borrow the regular Tree-sitter provider', () => {
  const syntax = editorDiffSyntax(editorSyntaxColors('tree-sitter-dark'))

  expect(syntax.backend.kind).toBe('tree-sitter')
  expect(syntax.backend.provider).toBe(editorSyntaxProvider())
})

test('markdown keeps the editor palette under an imported theme', () => {
  expect(editorSyntaxColors('dark-plus', 'markdown')).toBe('editor')
})
