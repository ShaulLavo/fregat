import { describe, expect, it } from 'vitest'

import { languageIdForFilePath, lspLanguageIdForPath } from '../language'

describe('languageIdForFilePath', () => {
  it('resolves extensionless basenames from the basename table', () => {
    expect(languageIdForFilePath('/repo/Makefile')).toBe('makefile')
    expect(languageIdForFilePath('/repo/Dockerfile')).toBe('dockerfile')
  })

  it('resolves ordinary extensions', () => {
    expect(languageIdForFilePath('/repo/a.sh')).toBe('shellscript')
    expect(languageIdForFilePath('/repo/a.ts')).toBe('typescript')
    expect(languageIdForFilePath('/repo/a.tsx')).toBe('tsx')
  })

  it('recognizes lockfiles by their actual format', () => {
    expect(languageIdForFilePath('/repo/Cargo.lock')).toBe('toml')
    expect(languageIdForFilePath('/repo/yarn.lock')).toBeNull()
    expect(languageIdForFilePath('/repo/bun.lock')).toBe('jsonc')
    expect(languageIdForFilePath('/repo/unknown.lock')).toBeNull()
  })

  it('returns null for what it cannot name, never a text fallback', () => {
    expect(languageIdForFilePath('/repo/unknown.xyz')).toBeNull()
    expect(languageIdForFilePath('/repo/no-extension-file')).toBeNull()
  })
})

describe('lspLanguageIdForPath', () => {
  it('renames the JSX-bearing extensions the grammar table calls plain ts/js', () => {
    expect(languageIdForFilePath('/a/b/Row.tsx')).toBe('tsx')
    expect(lspLanguageIdForPath('/a/b/Row.tsx')).toBe('typescriptreact')
    expect(lspLanguageIdForPath('/a/b/Row.jsx')).toBe('javascriptreact')
  })

  it('leaves everything else to the grammar id', () => {
    expect(lspLanguageIdForPath('/a/b/plugin.ts')).toBeUndefined()
    expect(lspLanguageIdForPath('/a/b/main.js')).toBeUndefined()
    expect(lspLanguageIdForPath('/a/b/README.md')).toBeUndefined()
    expect(lspLanguageIdForPath('/a/b/Makefile')).toBeUndefined()
    expect(lspLanguageIdForPath('/repo/unknown.xyz')).toBeUndefined()
    expect(lspLanguageIdForPath('/repo/no-extension-file')).toBeUndefined()
  })

  it('reads the last segment, so a dotted directory is not an extension', () => {
    expect(lspLanguageIdForPath('file:///a/b.tsx/plugin.ts')).toBeUndefined()
    expect(lspLanguageIdForPath('file:///a/my.dir/Row.tsx')).toBe('typescriptreact')
  })

  it('names the JSONC configs so tsserver does not choke on comments', () => {
    expect(lspLanguageIdForPath('/repo/tsconfig.json')).toBe('jsonc')
    expect(lspLanguageIdForPath('/repo/tsconfig.base.json')).toBe('jsonc')
    expect(lspLanguageIdForPath('/a/b/data.jsonc')).toBe('jsonc')
    expect(lspLanguageIdForPath('/a/b/tsconfig.build.json')).toBe('jsonc')
    expect(lspLanguageIdForPath('/a/b/jsconfig.json')).toBe('jsonc')
    expect(lspLanguageIdForPath('file:///a/b/.eslintrc.json')).toBe('jsonc')
    expect(lspLanguageIdForPath('/repo/.vscode/settings.json')).toBe('jsonc')
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
