import { beforeAll, expect, test } from 'vitest'
import { init, MarkdownDocument } from 'tree-sitter-md'
import { markdownInlineReplacements } from '../../markdown/src/replacements'
import { createDocumentTextSnapshot, createStringTextSnapshot } from '../src/documentTextSnapshot'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { createInlineMap } from '../src/inlineMap'
import { DisplayProjection } from '../src/virtualization/displayProjection'

beforeAll(() => init())

test.each([
  [
    'read [the long label with words and averylongidentifier](https://example.com) now',
    'read the long label with words and averylongidentifier now',
  ],
  [
    'read **averylongidentifier** and _emphasized words_ now',
    'read averylongidentifier and emphasized words now',
  ],
  [
    'use `@singapore-editor/tree-sitter-languages` now',
    'use @singapore-editor/tree-sitter-languages now',
  ],
])('wraps Markdown preview text for %s', (text, expected) => {
  const document = new MarkdownDocument()
  try {
    document.setText(text)
    const specs = markdownInlineReplacements(
      createStringTextSnapshot(text),
      document.decorations(0, text.length),
    )
    const snapshot = createPieceTableSnapshot(text)
    const projection = new DisplayProjection({
      textSnapshot: createDocumentTextSnapshot(snapshot),
      inlineMap: createInlineMap(snapshot, specs),
      foldMap: null,
      injectedTextRows: [],
      wrapColumn: 10,
      wrapBreak: 'word',
      tabSize: 4,
    })
    let joined = ''
    for (let index = 0; index < projection.rowCount; index += 1) {
      const row = String(projection.getRow(index)!.text)
      expect(row.trimEnd().length, row).toBeLessThanOrEqual(10)
      joined += row
    }
    expect(joined).toBe(expected)
  } finally {
    document.dispose()
  }
})
