import { expect, test } from 'vitest'
import { documentContributionFindings } from './document-contributions.mjs'

const consumer = 'editor/examples/app/src/main.ts'

test.each([
  "import { TreeSitterWorkerClient as Parser } from '@singapore-editor/tree-sitter'; new Parser()",
  "export { TreeSitterSyntaxSession as Session } from '@singapore-editor/tree-sitter'",
  "import * as Tree from '@singapore-editor/tree-sitter'; new Tree['TreeSitterWorkerClient']()",
  "import * as Tree from '../../../packages/tree-sitter/src/treeSitter/workerClient'; const { TreeSitterWorkerClient: Client } = Tree; new Client()",
  'const { subscribe: observe } = context.buffer; observe.call(context.buffer, listener)',
  "import { createEditorTextBuffer as create } from '@singapore-editor/core/document'; const text = create('x'); text.subscribe(listener)",
  "snapshot?.['changesSinceDocumentSyncPoint']?.(old)",
  'const { changesSinceDocumentSyncPoint: changes } = snapshot; changes(old)',
  'buffer?.subscribe(listener)',
  'context.buffer.subscribe(listener)',
  'const source = context.buffer; const peer = source; peer.subscribe(listener)',
  'const { buffer: active } = context; active.subscribe(listener)',
  'class Consumer { private workerDocumentState = null }',
  'let structuralDispatchPoint = currentPoint',
  'function composeSkippedChanges() { return [] }',
  'new TreeSitterSyntaxSession(options)',
  "import { defineDocumentOperation } from '@singapore-editor/core/internal/document-worker'",
  "export * from '@singapore-editor/core/internal/document-worker'",
  "import('@singapore-editor/core/dist/documentSession.js')",
  "import { read } from '../../../packages/editor/src/documentSession'",
])('rejects a source ownership bypass: %s', (source) => {
  expect(documentContributionFindings(source, consumer).length).toBeGreaterThan(0)
})

test.each([
  "import { createTreeSitterWorkerOwner, createTreeSitterSyntaxProvider } from '@singapore-editor/tree-sitter'",
  "import { createShikiHighlighterProvider } from '@singapore-editor/core/shiki'",
  'contributions.retain(operation, input); contributions.request(operation, input, demand)',
  "const note = 'changesSinceDocumentSyncPoint'; const object = { changesSinceDocumentSyncPoint() {} }",
])('permits published operations and inert names: %s', (source) => {
  expect(documentContributionFindings(source, consumer)).toEqual([])
})

test.each([
  [
    'editor/packages/tree-sitter/src/session.ts',
    "import { waitForDocumentWork } from '@singapore-editor/core/internal/document-worker'",
  ],
  ['editor/packages/find/src/plugin.ts', 'snapshot.changesSinceDocumentSyncPoint(point, null)'],
  [
    'editor/packages/editor/src/semanticTokenLayer.ts',
    'snapshot.changesSinceDocumentSyncPoint(point, null)',
  ],
  ['editor/packages/editor/src/editor/documentDelivery.ts', 'buffer.subscribe(listener)'],
  [
    'apps/web/src/features/workbench/components/csv-table.tsx',
    'const { subscribe: observe } = context.buffer; observe.call(context.buffer, listener)',
  ],
])('permits the explicit %s adapter', (filename, source) => {
  expect(documentContributionFindings(source, filename)).toEqual([])
})
