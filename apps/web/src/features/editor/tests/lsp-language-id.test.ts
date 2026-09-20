import { describe, expect, it } from 'vitest'

import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import { lspLanguageIdForPath } from '@/features/editor/utils/lsp-language-id'

describe('lspLanguageIdForPath', () => {
  it('renames the JSX-bearing extensions the grammar table calls plain ts/js', () => {
    expect(languageIdForFilePath('/a/b/Row.tsx')).toBe('tsx')
    expect(lspLanguageIdForPath('/a/b/Row.tsx')).toBe('typescriptreact')
    expect(lspLanguageIdForPath('/a/b/Row.jsx')).toBe('javascriptreact')
  })

  it('leaves everything else to the editor id', () => {
    expect(lspLanguageIdForPath('/a/b/plugin.ts')).toBeUndefined()
    expect(lspLanguageIdForPath('/a/b/main.js')).toBeUndefined()
    expect(lspLanguageIdForPath('/a/b/README.md')).toBeUndefined()
    expect(lspLanguageIdForPath('/a/b/Makefile')).toBeUndefined()
  })

  it('reads the last segment, so a dotted directory is not an extension', () => {
    expect(lspLanguageIdForPath('file:///a/b.tsx/plugin.ts')).toBeUndefined()
    expect(lspLanguageIdForPath('file:///a/my.dir/Row.tsx')).toBe('typescriptreact')
  })

  it('calls the comment-bearing config files jsonc, which is what legalises a comment', () => {
    expect(lspLanguageIdForPath('/a/b/data.jsonc')).toBe('jsonc')
    expect(lspLanguageIdForPath('/a/b/tsconfig.json')).toBe('jsonc')
    expect(lspLanguageIdForPath('/a/b/tsconfig.build.json')).toBe('jsonc')
    expect(lspLanguageIdForPath('/a/b/jsconfig.json')).toBe('jsonc')
    expect(lspLanguageIdForPath('file:///a/b/.eslintrc.json')).toBe('jsonc')
    expect(lspLanguageIdForPath('/a/.vscode/settings.json')).toBe('jsonc')
    expect(lspLanguageIdForPath('/a/.platform/settings.json')).toBe('jsonc')
    expect(lspLanguageIdForPath('/a/.devcontainer/devcontainer.json')).toBe('jsonc')
  })

  it('leaves ordinary json alone, so strict data files keep strict validation', () => {
    expect(lspLanguageIdForPath('/a/b/package.json')).toBeUndefined()
    expect(lspLanguageIdForPath('/a/b/data.json')).toBeUndefined()
    // The directory rule is the parent segment only: a `.vscode` grandparent is someone else's file.
    expect(lspLanguageIdForPath('/a/.vscode/nested/data.json')).toBeUndefined()
  })
})
