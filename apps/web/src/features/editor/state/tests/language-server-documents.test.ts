import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core/document'
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
    const documents = new LanguageServerDocuments(20)
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
    const documents = new LanguageServerDocuments(20)
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
    expect(documents.getOrCreate('a', buffer, 'typescript', () => next)?.document).toBe(
      next.document,
    )
    documents.dispose()
  })

  it('replaces sessions for a new buffer or server configuration and drops a renamed key', () => {
    const documents = new LanguageServerDocuments(20)
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

it('drops a retained document synchronously when edits cross the budget and resumes after undo', () => {
  const buffer = createEditorTextBuffer('1234')
  const documents = new LanguageServerDocuments(4 / 1_048_576)
  const create = vi.fn(() => entry(buffer))
  const first = documents.getOrCreate('a', buffer, 'ts', create)!
  const dispose = vi.spyOn(first.document, 'dispose')
  const session = createEditorBufferSession(buffer)
  session.applyText('5')
  expect(dispose).toHaveBeenCalledOnce()
  expect(documents.getOrCreate('a', buffer, 'ts', create)).toBeNull()
  expect(create).toHaveBeenCalledOnce()
  buffer.undo()
  expect(documents.getOrCreate('a', buffer, 'ts', create)).not.toBe(first)
  expect(create).toHaveBeenCalledTimes(2)
  const current = documents.getOrCreate('a', buffer, 'ts', create)!
  const secondDispose = vi.spyOn(current.document, 'dispose')
  documents.setLimit(3 / 1_048_576)
  expect(secondDispose).toHaveBeenCalledOnce()
  expect(documents.accepts(buffer)).toBe(false)
  documents.dispose()
})
