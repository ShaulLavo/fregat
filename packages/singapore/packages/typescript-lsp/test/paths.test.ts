import { describe, expect, it } from 'vitest'
import {
  documentUriToFileName,
  fileNameToDocumentUri,
  isTypeScriptFileName,
  isTypeScriptLspSourceFileName,
  pathOrUriToDocumentUri,
  sourcePathToFileName,
} from '../src'

describe('TypeScript LSP path helpers', () => {
  it('maps repo paths to VFS file names', () => {
    expect(sourcePathToFileName('packages/editor/src/editor.ts')).toBe(
      '/packages/editor/src/editor.ts',
    )
    expect(sourcePathToFileName('/packages/editor/src/editor.ts')).toBe(
      '/packages/editor/src/editor.ts',
    )
  })

  it('round-trips file names through file URIs', () => {
    const uri = fileNameToDocumentUri('/src/a file.ts')

    expect(uri).toBe('file:///src/a%20file.ts')
    expect(documentUriToFileName(uri)).toBe('/src/a file.ts')
  })

  it('normalizes source paths and file URIs to document URIs', () => {
    expect(pathOrUriToDocumentUri('src/index.ts')).toBe('file:///src/index.ts')
    expect(pathOrUriToDocumentUri('file:///src/a%20file.ts')).toBe('file:///src/a%20file.ts')
  })

  it('identifies TypeScript source extensions', () => {
    expect(isTypeScriptFileName('/src/index.ts')).toBe(true)
    expect(isTypeScriptFileName('/src/index.tsx')).toBe(true)
    expect(isTypeScriptFileName('/src/index.js')).toBe(false)
  })

  it('identifies TypeScript language service source extensions', () => {
    expect(isTypeScriptLspSourceFileName('/src/index.ts')).toBe(true)
    expect(isTypeScriptLspSourceFileName('/src/index.tsx')).toBe(true)
    expect(isTypeScriptLspSourceFileName('/src/index.js')).toBe(true)
    expect(isTypeScriptLspSourceFileName('/src/index.jsx')).toBe(true)
    expect(isTypeScriptLspSourceFileName('/src/readme.md')).toBe(false)
  })
})
