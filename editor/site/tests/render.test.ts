import { expect, test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { decodePaintSnapshot } from '@singapore-editor/core/paint'
import { resolveDocsLink } from '../src/manual/links'
import type { CapturedDocument } from '../src/manual/captured'

test('maps Markdown links to page URLs', () => {
  expect(
    resolveDocsLink(
      'start-here/quick-start.md',
      'introduction.md',
      '/singapore/',
      new Set(['start-here/introduction.md']),
    ),
  ).toEqual({ href: '/singapore/docs/start-here/introduction/', md: 'start-here/introduction.md' })
})
const path = new URL('../.capture/documents.json', import.meta.url)
test.skipIf(!existsSync(path))(
  'every browser-produced document has admitted paint and complete semantic rows',
  () => {
    const { documents } = JSON.parse(readFileSync(path, 'utf8')) as {
      documents: Record<string, CapturedDocument>
    }
    expect(Object.keys(documents).length).toBeGreaterThan(20)
    for (const [file, document] of Object.entries(documents)) {
      for (const theme of ['light', 'dark'] as const) {
        const paint = decodePaintSnapshot(document[theme].paint)
        expect(paint?.format, file).toBe(6)
        if (paint?.format !== 6) continue
        expect(paint.rows.length, file).toBe(document.text.split('\n').length)
        for (const html of Object.values(document[theme].html)) {
          expect(html, file).toContain('data-editor-document-paint')
        }
        for (const row of paint.rows) {
          if (row.heading) expect(document[theme].anchors[752]).toHaveProperty(row.heading.id)
        }
      }
    }
  },
)
