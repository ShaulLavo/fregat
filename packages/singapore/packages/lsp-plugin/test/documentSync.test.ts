import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core/document'
import { createDocumentLogicalRevisionScope } from '@singapore-editor/core/document'
import { LspWorkspace } from '@singapore-editor/lsp'
import { DocumentSync, activeDocumentForSnapshot } from '../src/documentSync'
import { bufferDocumentSnapshot } from '../src/documentSnapshot'
import type { LanguageServerDocumentSyncOptions } from '../src/types'

const fixtures: { readonly sync: DocumentSync }[] = []
afterEach(() => {
  for (const current of fixtures.splice(0)) current.sync.dispose()
})

function fixture(text = 'abc', options: LanguageServerDocumentSyncOptions = {}) {
  let buffer = createEditorTextBuffer(text)
  let view = createEditorBufferSession(buffer)
  const workspace = new LspWorkspace()
  const events: string[] = []
  workspace.attachClient({
    didOpenDocument: (document) => events.push(`open:${document.uri}:${document.version}`),
    didChangeDocument: (document) => events.push(`change:${document.uri}:${document.version}`),
    didCloseDocument: (document) => events.push(`close:${document.uri}:${document.version}`),
    didSaveDocument() {},
  })
  const presenter = { clear: vi.fn(), render: vi.fn(), publishSummary: vi.fn() }
  const errors: unknown[] = []
  const connection = { generation: 1, ready: Promise.resolve(), isCurrent: () => true }
  const sync = new DocumentSync(workspace, presenter, {
    ...options,
    logicalRevisionScope: createDocumentLogicalRevisionScope(),
    getSourceOwner: () => ({ buffer }),
    getConnection: () => connection,
    onDocumentClosed() {},
    onDocumentChanged() {},
    onError: (error) => errors.push(error),
  })
  const current = {
    sync,
    workspace,
    presenter,
    errors,
    events,
    snapshot: () =>
      bufferDocumentSnapshot({ buffer, uri: 'file:///src/index.ts', languageId: 'typescript' }),
    edit: (from: number, to: number, text: string) => view.applyEdits([{ from, to, text }]),
    replace(text: string) {
      buffer = createEditorTextBuffer(text)
      view = createEditorBufferSession(buffer)
    },
    point: () => buffer.getDocumentSyncPoint(),
    rawSnapshot: () => buffer.getTextSnapshot(),
  }
  fixtures.push(current)
  return current
}

describe('document protocol presentation', () => {
  it('resolves opaque identity and protocol language while source comes from the owner', async () => {
    const f = fixture('const view = <div />;', {
      uriForDocument: () => 'file:///src/view.tsx',
      languageIdForDocument: () => 'typescriptreact',
    })
    const snapshot = { ...f.snapshot(), documentId: '["file","src/view.tsx"]' }
    await f.sync.sync(snapshot)
    expect(f.sync.activeDocument).toMatchObject({
      uri: 'file:///src/view.tsx',
      languageId: 'typescriptreact',
    })
    expect(
      activeDocumentForSnapshot(snapshot, {
        uriForDocument: () => 'file:///src/view.tsx',
        languageIdForDocument: () => 'typescriptreact',
      }),
    ).toMatchObject({ uri: 'file:///src/view.tsx', languageId: 'typescriptreact' })
    expect(f.events).toEqual(['open:file:///src/view.tsx:0'])
    expect(f.sync.activeDocument?.sourceSegment).toBe(f.point().segment)
    expect(f.sync.activeDocument?.textSnapshot).not.toBe(f.rawSnapshot())
  })

  it('honors URI and language admission and closes the retained source', async () => {
    let uri: string | null = null
    let allowed = true
    const f = fixture('one', { uriForDocument: () => uri, shouldSyncLanguageId: () => allowed })
    await f.sync.sync(f.snapshot())
    expect(f.events).toEqual([])
    uri = 'file:///src/index.ts'
    await f.sync.sync(f.snapshot())
    allowed = false
    await f.sync.sync(f.snapshot())
    expect(f.workspace.documents).toEqual([])
    expect(f.sync.activeDocument).toBeNull()
    allowed = true
    await f.sync.sync(f.snapshot())
    uri = null
    await f.sync.sync(f.snapshot())
    expect(f.events).toEqual([
      'open:file:///src/index.ts:0',
      'close:file:///src/index.ts:0',
      'open:file:///src/index.ts:1',
      'close:file:///src/index.ts:1',
    ])
  })

  it('releases the outgoing owner and binds a replacement canonical buffer', async () => {
    const f = fixture('one')
    await f.sync.sync(f.snapshot())
    const previous = f.sync.activeDocument
    f.replace('two')
    await f.sync.sync(f.snapshot())
    expect(f.sync.activeDocument?.textSnapshot.readRange(0, 3)).toBe('two')
    expect(f.sync.activeDocument?.sourceSegment).not.toBe(previous?.sourceSegment)
    expect(f.events).toEqual([
      'open:file:///src/index.ts:0',
      'close:file:///src/index.ts:0',
      'open:file:///src/index.ts:1',
    ])
  })

  it('projects diagnostics through canonical changes and rejects late protocol versions', async () => {
    const f = fixture('abc')
    await f.sync.sync(f.snapshot())
    const diagnostic = {
      range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } },
      message: 'fixture',
    }
    f.sync.publishDiagnostics({
      uri: 'file:///src/index.ts',
      version: 0,
      diagnostics: [diagnostic],
    })
    expect(f.sync.diagnostics).toEqual([diagnostic])
    f.edit(0, 0, 'X')
    await expect.poll(() => f.sync.activeDocument?.lspVersion).toBe(1)
    expect(f.sync.diagnostics[0]?.range).toEqual({
      start: { line: 0, character: 2 },
      end: { line: 0, character: 3 },
    })
    f.sync.publishDiagnostics({ uri: 'file:///src/index.ts', version: 0, diagnostics: [] })
    f.sync.pullDiagnostics('file:///src/index.ts', 0, [])
    f.sync.publishDiagnostics({ uri: 'file:///other.ts', version: 1, diagnostics: [] })
    expect(f.sync.diagnostics).toHaveLength(1)
    f.sync.pullDiagnostics('file:///src/index.ts', 1, [])
    expect(f.sync.diagnostics).toEqual([])
    f.sync.close()
    expect(f.sync.activeDocument).toBeNull()
    expect(f.presenter.clear).toHaveBeenCalled()
  })

  it('keeps presentation errors outside the already accepted source acknowledgement', async () => {
    const f = fixture('abc')
    f.presenter.render.mockImplementationOnce(() => {
      throw new DOMException('Fixture renderer failed', 'InvalidStateError')
    })
    await f.sync.sync(f.snapshot())
    expect(f.errors).toHaveLength(1)
    expect(f.sync.activeDocument?.lspVersion).toBe(0)
    f.edit(3, 3, 'X')
    await expect.poll(() => f.sync.activeDocument?.lspVersion).toBe(1)
    expect(f.events).toEqual(['open:file:///src/index.ts:0', 'change:file:///src/index.ts:1'])
  })

  it('accepts a plain text editor identity when its URI is explicitly provided', async () => {
    const f = fixture('plain', { uriForDocument: () => 'file:///plain.ts' })
    await f.sync.sync({ ...f.snapshot(), documentId: null })
    expect(f.sync.activeDocument?.uri).toBe('file:///plain.ts')
  })
})
