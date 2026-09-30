import { describe, expect, it } from 'vitest'
import {
  documentUriToFileName,
  fileNameToDocumentUri,
  pathOrUriToDocumentUri,
  sourcePathToFileName,
} from '../src/paths'

describe('language server path helpers', () => {
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
})
