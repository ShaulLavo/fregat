import { expect, test } from 'vitest'
import { documentContributionFindings } from './document-contributions.mjs'

const consumer = 'apps/web/src/features/editor/state/consumer.ts'

test.each([
  'const { subscribe: observe } = context.buffer; observe.call(context.buffer, listener)',
  "import { createEditorTextBuffer as create } from '@singapore-editor/core/document'; const text = create('x'); text.subscribe(listener)",
  "snapshot?.['changesSinceDocumentSyncPoint']?.(old)",
  'const { changesSinceDocumentSyncPoint: changes } = snapshot; changes(old)',
  'buffer?.subscribe(listener)',
  'context.buffer.subscribe(listener)',
  'const source = context.buffer; const peer = source; peer.subscribe(listener)',
  'const { buffer: active } = context; active.subscribe(listener)',
  "import { defineDocumentOperation } from '@singapore-editor/core/internal/document-worker'",
  "export * from '@singapore-editor/core/internal/document-worker'",
  "import('@singapore-editor/core/dist/documentSession.js')",
  "import { read } from '@singapore-editor/core/src/documentSession'",
])('rejects a consumer ownership bypass: %s', (source) => {
  expect(documentContributionFindings(source, consumer).length).toBeGreaterThan(0)
})

test.each([
  "import { createTreeSitterWorkerOwner, createTreeSitterSyntaxProvider } from '@singapore-editor/tree-sitter'",
  "import { createShikiHighlighterProvider } from '@singapore-editor/core/shiki'",
  'contributions.retain(operation, input); contributions.request(operation, input, demand)',
  "const note = 'changesSinceDocumentSyncPoint'; const object = { changesSinceDocumentSyncPoint() {} }",
  'class Consumer { private workerDocumentState = null }',
  'let structuralDispatchPoint = currentPoint',
  'function composeSkippedChanges() { return [] }',
])('permits published operations and unrelated names: %s', (source) => {
  expect(documentContributionFindings(source, consumer)).toEqual([])
})

test('permits an explicit synchronous view observer', () => {
  const filename = 'apps/web/src/features/workbench/components/csv-table.tsx'
  const source =
    'const { subscribe: observe } = context.buffer; observe.call(context.buffer, listener)'
  expect(documentContributionFindings(source, filename)).toEqual([])
})
