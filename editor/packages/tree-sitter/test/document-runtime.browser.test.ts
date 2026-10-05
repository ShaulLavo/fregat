import { expect, it } from 'vitest'
import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { createShikiHighlighterProvider, createShikiWorkerOwner } from '@singapore-editor/core/shiki'
import typescript from '@shikijs/langs/typescript'
import githubDark from '@shikijs/themes/github-dark'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'
import { createTreeSitterSyntaxProvider, createTreeSitterWorkerOwner } from '../src/index'

it('shares ordinary source across real configurations, composes edits and undo, and retires the last scope', async () => {
  const tree = createTreeSitterWorkerOwner()
  const shiki = createShikiWorkerOwner()
  const parser = createTreeSitterSyntaxProvider({ workerOwner: tree })
  const language = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find(item => item.id === 'typescript')
  if (!language) throw new TypeError('TypeScript fixture registration is required')
  parser.registerLanguage(language)
  const highlighter = createShikiHighlighterProvider({
    workerOwner: shiki,
    resolveLanguage: async () => typescript,
    resolveTheme: async () => ({ ...githubDark, name: 'github-dark' }),
  })
  const buffer = createEditorTextBuffer('const answer = "old😀";\r\nconst tail = answer;\r\n')
  const view = createEditorBufferSession(buffer)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'real.ts' })
  const syntax = analysis.borrowStructural({ provider: parser, languageId: 'typescript', includeCaptures: true })!
  const peer = analysis.borrowStructural({ provider: parser, languageId: 'typescript', includeCaptures: false })!
  const color = analysis.borrowHighlighter({ provider: highlighter, languageId: 'typescript' })!
  const current = async () => {
    const snapshot = buffer.getTextSnapshot()
    const attempts = await Promise.allSettled([syntax.refresh(snapshot), peer.refresh(snapshot), color.refresh(snapshot)])
    const results = []
    for (const [index, attempt] of attempts.entries()) {
      if (attempt.status === 'rejected') {
        console.info('source admission failure', { family: ['structural', 'peer', 'highlighter'][index], error: String(attempt.reason), internal: attempt.reason.internal, tree: tree.inspect(), shiki: shiki.inspect() })
        throw attempt.reason
      }
      results.push(attempt.value)
    }
    for (const result of results) expect(result.tokens.length).toBeGreaterThan(0)
    expect(syntax.read()).toMatchObject({ kind: 'ready', revision: buffer.getRevision(), snapshot })
    const exact = snapshot.readRange(0, snapshot.length)
    const syntaxResult = syntax.getResult()
    expect(syntaxResult.captures.some(capture => exact.slice(capture.startIndex, capture.endIndex) === '"old😀"')).toBe(true)
    await Promise.all([tree.awaitIdleFence(), shiki.awaitIdleFence()])
    expect((await tree.inspectRetention())?.source.documentCount).toBe(1)
    expect((await shiki.inspectRetention())?.source.documents).toBe(1)
  }
  try {
    await current()
    const original = buffer.materializeFullText()
    const tail = original.indexOf('tail')
    view.applyEdits([{ from: tail, to: tail + 4, text: 'tail🪐' }])
    view.applyEdits([{ from: buffer.getTextSnapshot().length, to: buffer.getTextSnapshot().length, text: '// new\nline\n' }])
    await current()
    view.undo()
    view.undo()
    expect(buffer.materializeFullText()).toBe(original)
    await current()
    view.redo()
    await current()
    syntax.dispose()
    analysis.reclaimInactive({ reason: 'inactive-budget', runtimeSessionIds: [syntax.runtimeSessionId] })
    await tree.awaitIdleFence()
    expect((await tree.inspectRetention())?.source.documentCount).toBe(1)
    expect(peer.read().kind).toBe('ready')
    peer.dispose()
    analysis.reclaimInactive({ reason: 'inactive-budget', runtimeSessionIds: [peer.runtimeSessionId] })
    await tree.awaitIdleFence()
    expect((await tree.inspectRetention())?.source).toEqual({ documentCount: 0, readCount: 0, pinCount: 0, sourceUnits: 0 })
    expect((await shiki.inspectRetention())?.source.documents).toBe(1)
    color.dispose()
    analysis.reclaimInactive({ reason: 'inactive-budget', runtimeSessionIds: [color.runtimeSessionId] })
    await shiki.awaitIdleFence()
    expect((await shiki.inspectRetention())?.source).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
    for (let cycle = 0; cycle < 40; cycle++) {
      const transient = analysis.borrowStructural({ provider: parser, languageId: 'typescript' })!
      await transient.refresh(buffer.getTextSnapshot())
      transient.dispose()
      analysis.reclaimInactive({ reason: 'inactive-budget', runtimeSessionIds: [transient.runtimeSessionId] })
      await tree.awaitIdleFence()
      const receipt = await tree.inspectRetention()
      expect(receipt?.documentCount).toBe(0)
      expect(receipt?.source).toEqual({ documentCount: 0, readCount: 0, pinCount: 0, sourceUnits: 0 })
    }
  } finally {
    analysis.dispose()
    await Promise.all([tree.dispose(), shiki.dispose()])
  }
  expect(tree.inspect()).toMatchObject({ lifecycle: 'disposed', pendingRequests: 0 })
  expect(shiki.inspect()).toMatchObject({ lifecycle: 'disposed', pendingRequests: 0 })
})
