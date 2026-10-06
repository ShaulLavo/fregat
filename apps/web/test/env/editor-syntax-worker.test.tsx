import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import {
  createTreeSitterSyntaxProvider,
  createTreeSitterWorkerOwner,
} from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'
import { expect, test } from '../fixtures'

test.skipIf(typeof Worker === 'undefined')(
  'parses JSON through the real browser-bundled syntax worker',
  async () => {
    const contribution = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((entry) => entry.id === 'json')
    if (!contribution) return expect.fail('JSON language contribution is missing')
    const worker = createTreeSitterWorkerOwner()
    const provider = createTreeSitterSyntaxProvider({ workerOwner: worker })
    provider.registerLanguage(contribution)
    const buffer = createEditorTextBuffer('{"answer": 42}')
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'worker-observation.json' })
    const lease = analysis.borrowStructural({ provider, languageId: 'json', syntaxMode: 'full' })
    try {
      expect(lease).not.toBeNull()
      if (!lease) return expect.fail('JSON syntax contribution is missing')
      const result = await lease.refresh(buffer.getTextSnapshot())
      expect(result.projection.snapshot.documentId).toBe('worker-observation.json')
      expect(result.projection.language.languageId).toBe('json')
      expect(result.captures.length).toBeGreaterThan(0)
    } finally {
      lease?.dispose()
      analysis.dispose()
      await worker.dispose()
    }
  },
)
