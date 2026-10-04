import { createPieceTableSnapshot } from '@singapore-editor/core/document'
import {
  TreeSitterWorkerClient,
  resolveTreeSitterLanguageContribution,
} from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'
import { expect, test } from '../fixtures'

test.skipIf(typeof Worker === 'undefined')(
  'parses JSON through the real browser-bundled syntax worker',
  async () => {
    const contribution = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((entry) => entry.id === 'json')
    if (!contribution) return expect.fail('JSON language contribution is missing')
    const descriptor = await resolveTreeSitterLanguageContribution(contribution)
    const backend = new TreeSitterWorkerClient()
    try {
      await backend.registerLanguages([descriptor])
      const result = await backend.parse({
        documentId: 'worker-observation.json',
        runtimeSessionId: 'worker-observation',
        snapshotVersion: 1,
        languageId: 'json',
        snapshot: createPieceTableSnapshot('{"answer": 42}'),
      })
      expect(result?.documentId).toBe('worker-observation.json')
      expect(result?.languageId).toBe('json')
      expect(result?.captures.length).toBeGreaterThan(0)
    } finally {
      await backend.dispose()
    }
  },
)
