import { expect, test } from '../../../../test/fixtures'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { referencePreview } from '@/features/editor/utils/language-server-references'
import { filesystemPath } from '@/lib/documents/utils/identity'

test('reference previews read CRLF lines and distinguish missing from blank lines', () => {
  const content = 'alpha\r\n\r\ngamma\r\n'
  const path = filesystemPath('/repo/references.ts')
  const document = createEditorDocumentStore().getState().ensureLiveEditorDocument({
    content,
    path,
    size: content.length,
    mtimeMs: 100,
    version: 'test:references',
  })
  const previews = [0, 1, 2, 3, 4, -1].map((line) =>
    referencePreview(document, {
      path,
      uri: 'file:///repo/references.ts',
      range: { start: { line, character: 0 }, end: { line, character: 1 } },
    }),
  )
  expect(previews).toEqual([
    'alpha',
    '(blank line)',
    'gamma',
    '(blank line)',
    'Line 5, column 1',
    'Line 0, column 1',
  ])
})
