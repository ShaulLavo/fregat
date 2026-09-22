import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { createLanguageServerDocument } from '@singapore-editor/lsp-plugin'
import { describe, expect, it, vi } from 'vitest'
import {
  LanguageServerDocuments,
  type LanguageServerDocumentEntry,
} from '@/features/editor/state/language-server-documents'
import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'

function entry(buffer = createEditorTextBuffer('')): LanguageServerDocumentEntry {
  return {
    document: createLanguageServerDocument({
      buffer,
      uri: 'file:///a.ts',
      languageId: 'typescript',
      lanes: [],
    }),
    status: createEditorLanguageServerStatusSource(),
    semanticControllers: new Map(),
  }
}

describe('open LSP documents', () => {
  it('reuses a session across views and releases it when its last open reference disappears', () => {
    const documents = new LanguageServerDocuments()
    const buffer = createEditorTextBuffer('')
    const created = entry(buffer)
    const dispose = vi.spyOn(created.document, 'dispose')
    const create = vi.fn(() => created)
    expect(documents.getOrCreate('a', buffer, 'typescript', create)).toMatchObject(created)
    documents.retain(new Map([['a', buffer]]))
    expect(documents.getOrCreate('a', buffer, 'typescript', create)).toMatchObject(created)
    expect(create).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()
    documents.retain(new Map())
    expect(dispose).toHaveBeenCalledTimes(1)
    documents.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('releases retained sessions on a settings generation change, once per generation', () => {
    const documents = new LanguageServerDocuments()
    const buffer = createEditorTextBuffer('')
    const first = entry(buffer)
    const dispose = vi.spyOn(first.document, 'dispose')
    documents.configure(1)
    documents.getOrCreate('a', buffer, 'typescript', () => first)
    documents.configure(1)
    expect(dispose).not.toHaveBeenCalled()
    documents.configure(2)
    expect(dispose).toHaveBeenCalledOnce()
    const next = entry(buffer)
    expect(documents.getOrCreate('a', buffer, 'typescript', () => next).document).toBe(
      next.document,
    )
    documents.dispose()
  })

  it('replaces sessions for a new buffer or server configuration and drops a renamed key', () => {
    const documents = new LanguageServerDocuments()
    const firstBuffer = createEditorTextBuffer('old')
    const secondBuffer = createEditorTextBuffer('new')
    const first = entry(firstBuffer)
    const second = entry(secondBuffer)
    const third = entry(secondBuffer)
    const firstDispose = vi.spyOn(first.document, 'dispose')
    const secondDispose = vi.spyOn(second.document, 'dispose')
    const thirdDispose = vi.spyOn(third.document, 'dispose')
    documents.getOrCreate('a', firstBuffer, 'typescript', () => first)
    documents.getOrCreate('a', secondBuffer, 'typescript', () => second)
    expect(firstDispose).toHaveBeenCalledOnce()
    documents.getOrCreate('a', secondBuffer, 'typescript+eslint', () => third)
    expect(secondDispose).toHaveBeenCalledOnce()
    documents.retain(new Map([['renamed', secondBuffer]]))
    expect(thirdDispose).toHaveBeenCalledOnce()
  })
})
