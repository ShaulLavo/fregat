import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import { createTreeSitterWorkerOwner } from '../src'
import {
  parseTreeDocument,
  admitTreeSource,
  prepareTreeEdit,
  editTreeDocument,
  retireTreeDocument,
  disposeTreeTransportDocuments,
} from './factories/transport'
import { readAll } from '../../editor/test/factories/snapshotText'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import documentSessionSource from '../../editor/src/documentSession.ts?raw'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index.ts'

import {
  applyBatchToPieceTable,
  createAnchorSelection,
  createPieceTableSnapshot,
  createDocumentTextSnapshot,
  createSelectionSet,
  insertIntoPieceTable,
  resolveSelection,
  type TextEdit,
} from '@singapore-editor/core/document'
import { reclaimPieceTableText } from '@singapore-editor/core/testing'
import { toEditorTokenStore } from '@singapore-editor/core/syntax'
import {
  expandTreeSitterSelection,
  createTreeSitterSyntaxProvider,
  resolveTreeSitterLanguageContribution,
  selectTreeSitterToken,
  shrinkTreeSitterSelection,
  type TreeSitterLanguageId,
  type TreeSitterWorkerRetentionSnapshot,
} from '../src'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'
import type {
  TreeSitterWorkerRequestPayload,
  TreeSitterWorkerResponse,
} from '../src/treeSitter/types'

describe.skipIf(typeof Worker === 'undefined')('tree-sitter worker client', () => {
  let workerClient: TreeSitterWorkerClient

  beforeEach(async () => {
    workerClient = new TreeSitterWorkerClient()
    await registerDefaultLanguages(workerClient)
  })

  afterEach(async () => {
    disposeTreeTransportDocuments()
    await workerClient.dispose()
  })

  it('compiles warmed languages and skips a grammar that fails to load', async () => {
    const typescript = await resolveTreeSitterLanguageContribution(
      TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((contribution) => contribution.id === 'typescript')!,
    )
    const broken = { ...typescript, id: 'broken', wasmUrl: 'data:application/wasm;base64,AA==' }

    await workerClient.warmLanguages([typescript, broken])
    await workerClient.awaitIdleFence()
    const parsed = await parseTreeDocument(workerClient, {
      documentId: 'warm.ts',
      runtimeSessionId: 'runtime-warm.ts',
      snapshotVersion: 1,
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot('const warmed = true;\n'))),
    })

    expect(parsed?.captures.length).toBeGreaterThan(0)
    expect(workerClient.inspect().lifecycle).toBe('ready')
  })

  it('parses and edits through the real browser Worker', async () => {
    const documentId = 'file.ts'
    const snapshot = createPieceTableSnapshot('const answer = 1;\n')
    const parsed = await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    expect(parsed?.documentId).toBe(documentId)
    expect(parsed?.snapshotVersion).toBe(1)
    expect(parsed?.captures.length).toBeGreaterThan(0)

    const edits = [{ from: 6, to: 12, text: 'value' }]
    const payload = await prepareTreeEdit(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      languageId: 'typescript',
      edits,
    })
    const edited = payload ? await editTreeDocument(workerClient, payload) : undefined

    expect(edited?.documentId).toBe(documentId)
    expect(edited?.snapshotVersion).toBe(2)
    expect(edited?.captures.length).toBeGreaterThan(0)
  })

  it('isolates equal logical documents by runtime session', async () => {
    const documentId = 'shared.ts'
    const firstRuntime = 'runtime-tree-first'
    const secondRuntime = 'runtime-tree-second'
    const firstText = 'const first = 1;\n'
    const secondText = 'const second = 2;\n'
    await Promise.all([
      parseTreeDocument(workerClient, {
        documentId,
        runtimeSessionId: firstRuntime,
        snapshotVersion: 1,
        languageId: 'typescript',
        text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(firstText))),
      }),
      parseTreeDocument(workerClient, {
        documentId,
        runtimeSessionId: secondRuntime,
        snapshotVersion: 1,
        languageId: 'typescript',
        text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(secondText))),
      }),
    ])

    retireTreeDocument(workerClient, firstRuntime)
    await workerClient.awaitRuntimeSessionIdle(firstRuntime)
    const result = await workerClient.queryRange({
      documentId,
      runtimeSessionId: secondRuntime,
      snapshotVersion: 1,
      languageId: 'typescript',
      includeHighlights: true,
      includeCaptures: true,
      range: { startIndex: 0, endIndex: secondText.length },
    })

    expect(result?.documentId).toBe(documentId)
    expect(result?.captures.length).toBeGreaterThan(0)
  })

  it('bounds source metadata after 40 real-worker runtime disposals', async () => {
    const snapshot = createPieceTableSnapshot('const answer = 1;\n')
    const payload = {
      documentId: 'shared.ts',
      languageId: 'typescript',
      snapshotVersion: 1,
      text: readAll(createDocumentTextSnapshot(snapshot)),
    }
    const survivor = await parseTreeDocument(workerClient, {
      ...payload,
      runtimeSessionId: 'runtime-survivor',
    })
    expect(survivor?.captures.length).toBeGreaterThan(0)
    const baseline = (await workerClient.inspectRetention())!.source
    expect(baseline).toEqual({
      documentCount: 1,
      readCount: 1,
      pinCount: 0,
      sourceUnits: snapshot.length,
    })
    const samples = []

    for (let cycle = 0; cycle < 40; cycle++) {
      const runtimeSessionId = `runtime-cycle-${cycle}`
      const parsed = await parseTreeDocument(workerClient, { ...payload, runtimeSessionId })
      expect(parsed?.captures).toEqual(survivor?.captures)
      expect((await workerClient.inspectRetention())!.source.documentCount).toBe(2)
      retireTreeDocument(workerClient, runtimeSessionId)
      await workerClient.awaitRuntimeSessionIdle(runtimeSessionId)
      await workerClient.awaitIdleFence()
      samples.push((await workerClient.inspectRetention())!.source)
    }

    expect(samples).toEqual(Array.from({ length: 40 }, () => baseline))
    const result = await workerClient.queryRange({
      ...payload,
      runtimeSessionId: 'runtime-survivor',
      includeCaptures: true,
      range: { startIndex: 0, endIndex: snapshot.length },
    })
    expect(result?.captures).toEqual(survivor?.captures)
    retireTreeDocument(workerClient, 'runtime-survivor')
    await workerClient.awaitRuntimeSessionIdle('runtime-survivor')
    await workerClient.awaitIdleFence()
    expect(workerClient.inspect()).toMatchObject({
      lifecycle: 'ready',
      pendingRequests: 0,
      workerGeneration: 1,
    })
  })

  it('parses copied original survivors through a warmed worker source cache', async () => {
    const prefix = 'const 名前 = "🎉";\n'
    const deleted = '// retired text\n'.repeat(4096)
    const original = createPieceTableSnapshot(prefix + deleted + 'export const last = 42;\n')
    const snapshot = applyBatchToPieceTable(original, [
      { from: prefix.length, to: prefix.length + deleted.length, text: '' },
    ])
    const request = {
      documentId: 'reclaimed.ts',
      runtimeSessionId: 'runtime-reclaimed',
      languageId: 'typescript',
    }
    const before = await parseTreeDocument(workerClient, {
      ...request,
      snapshotVersion: 1,
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })
    const compact = reclaimPieceTableText(snapshot)
    expect(compact.buffers).not.toBe(snapshot.buffers)
    const after = await parseTreeDocument(workerClient, {
      ...request,
      snapshotVersion: 2,
      text: readAll(createDocumentTextSnapshot(compact)),
    })
    expect(after?.captures.length).toBeGreaterThan(0)
    expect(after?.captures).toEqual(before?.captures)
    expect(after?.tokensPacked).toEqual(before?.tokensPacked)

    const edits = [{ from: prefix.length, to: prefix.length, text: '// new line\n' }]
    const nextSnapshot = applyBatchToPieceTable(compact, edits)
    const payload = await prepareTreeEdit(workerClient, {
      ...request,
      previousSnapshotVersion: 2,
      snapshotVersion: 3,
      edits,
    })
    const edited = payload ? await editTreeDocument(workerClient, payload) : undefined
    const full = await parseTreeDocument(workerClient, {
      ...request,
      runtimeSessionId: 'runtime-reclaimed-full',
      snapshotVersion: 3,
      text: readAll(createDocumentTextSnapshot(nextSnapshot)),
    })
    expect(edited?.captures.length).toBeGreaterThan(0)
    expect(edited?.captures).toEqual(full?.captures)
    expect(edited?.tokensPacked).toEqual(full?.tokensPacked)
  })

  it('parses equal-length divergent append tails without reusing the other branch text', async () => {
    const base = insertIntoPieceTable(createPieceTableSnapshot(''), 0, 'const value = ')
    const left = insertIntoPieceTable(base, base.length, '1;\n')
    const right = insertIntoPieceTable(base, base.length, 'x;\n')
    const request = {
      documentId: 'fork.ts',
      runtimeSessionId: 'runtime-fork',
      languageId: 'typescript',
    }
    const first = await parseTreeDocument(workerClient, {
      ...request,
      snapshotVersion: 1,
      text: readAll(createDocumentTextSnapshot(left)),
    })
    const second = await parseTreeDocument(workerClient, {
      ...request,
      snapshotVersion: 2,
      text: readAll(createDocumentTextSnapshot(right)),
    })
    const full = await parseTreeDocument(workerClient, {
      ...request,
      runtimeSessionId: 'runtime-fork-full',
      snapshotVersion: 2,
      text: readAll(createDocumentTextSnapshot(right)),
    })
    expect(second?.captures.length).toBeGreaterThan(0)
    expect(second?.captures).not.toEqual(first?.captures)
    expect(second?.captures).toEqual(full?.captures)
    expect(second?.tokensPacked).toEqual(full?.tokensPacked)
  })

  it('highlights PascalCase TSX component tag names and reports JSX folds', async () => {
    const documentId = 'main.tsx'
    const text = [
      'const view = (',
      '  <StrictMode>',
      '    <QueryClientProvider client={queryClient}>',
      '      <App />',
      '    </QueryClientProvider>',
      '  </StrictMode>',
      ');',
    ].join('\n')
    const snapshot = createPieceTableSnapshot(text)
    const parsed = await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'tsx',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    expect(parsed?.captures).toContainEqual({
      startIndex: text.indexOf('StrictMode'),
      endIndex: text.indexOf('StrictMode') + 'StrictMode'.length,
      captureName: 'constructor',
      languageId: 'tsx',
    })
    expect(parsed?.captures).toContainEqual({
      startIndex: text.indexOf('QueryClientProvider'),
      endIndex: text.indexOf('QueryClientProvider') + 'QueryClientProvider'.length,
      captureName: 'constructor',
      languageId: 'tsx',
    })
    expect(parsed?.folds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endLine: 5,
          languageId: 'tsx',
          startLine: 1,
          type: 'jsx_element',
        }),
        expect.objectContaining({
          endLine: 4,
          languageId: 'tsx',
          startLine: 2,
          type: 'jsx_element',
        }),
      ]),
    )
  })

  it('returns highlights for a lower document range after a parse-only editor parse', async () => {
    const documentId = 'large-lower-range.ts'
    const text = Array.from(
      { length: 12_000 },
      (_value, index) => `export const value${index} = ${index};`,
    ).join('\n')
    const snapshot = createPieceTableSnapshot(text)
    await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'typescript',
      resultMode: 'parseOnly',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    const topTarget = text.indexOf('value10')
    const topResult = await workerClient.queryRange({
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'typescript',
      includeHighlights: true,
      includeCaptures: false,
      range: { startIndex: 0, endIndex: 1_000 },
    })
    const target = text.indexOf('value10000')
    const result = await workerClient.queryRange({
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'typescript',
      includeHighlights: true,
      includeCaptures: false,
      range: { startIndex: target - 100, endIndex: target + 1_000 },
    })

    expect(packedTokensCoverRange(topResult?.tokensPacked, topTarget, topTarget + 7)).toBe(true)
    expect(packedTokensCoverRange(result?.tokensPacked, target, target + 10)).toBe(true)
  })

  it('returns an unavailable edit result when the incremental base was evicted', async () => {
    const documentId = 'missing-incremental-base.ts'
    await admitTreeSource(workerClient, `runtime-${documentId}`, documentId, 'const answer = 1;\n')
    const edit = { from: 6, to: 12, text: 'value' }
    const payload = await prepareTreeEdit(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      previousSnapshotVersion: 99,
      snapshotVersion: 100,
      languageId: 'typescript',
      edits: [edit],
      resultMode: 'parseOnly',
    })

    const result = payload ? await editTreeDocument(workerClient, payload) : 'missing-payload'

    expect(result).toBeUndefined()
  })

  it('matches a full parse after same-line inserts before later rows', async () => {
    const documentId = 'same-line-insert.ts'
    const text = [
      'export function alpha() {',
      '  return 1;',
      '}',
      'export function beta() {',
      '  return alpha();',
      '}',
    ].join('\n')
    const snapshot = createPieceTableSnapshot(text)
    await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    const editOffset = text.indexOf('return 1') + 'return'.length
    const edit = { from: editOffset, to: editOffset, text: ' value' }
    const nextSnapshot = applyBatchToPieceTable(snapshot, [edit])
    const payload = await prepareTreeEdit(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      languageId: 'typescript',
      edits: [edit],
    })
    const incremental = payload ? await editTreeDocument(workerClient, payload) : undefined
    const full = await parseTreeDocument(workerClient, {
      documentId: `${documentId}:full`,
      runtimeSessionId: `runtime-${documentId}:full`,
      snapshotVersion: 1,
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(nextSnapshot)),
    })

    expect(captureSignature(incremental?.captures ?? [])).toEqual(
      captureSignature(full?.captures ?? []),
    )
  })

  it('matches a full parse after inserting inside an identifier', async () => {
    const documentId = 'identifier-insert.ts'
    const text = [
      'export type DocumentSessionChangeKind = "edit" | "selection" | "undo" | "redo";',
      '',
      'export type EditorTimingMeasurement = {',
      '  readonly name: string;',
      '  readonly durationMs: number;',
      '};',
    ].join('\n')
    const snapshot = createPieceTableSnapshot(text)
    await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    const editOffset = text.indexOf('Document') + 'Docume'.length
    const edit = { from: editOffset, to: editOffset, text: 'f' }
    const nextSnapshot = applyBatchToPieceTable(snapshot, [edit])
    const payload = await prepareTreeEdit(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      languageId: 'typescript',
      edits: [edit],
    })
    const incremental = payload ? await editTreeDocument(workerClient, payload) : undefined
    const full = await parseTreeDocument(workerClient, {
      documentId: `${documentId}:full`,
      runtimeSessionId: `runtime-${documentId}:full`,
      snapshotVersion: 1,
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(nextSnapshot)),
    })

    expect(captureSignature(incremental?.captures ?? [])).toEqual(
      captureSignature(full?.captures ?? []),
    )
  })

  it('matches a full parse after inserting inside the real document session source', async () => {
    const documentId = 'document-session-source.ts'
    const snapshot = createPieceTableSnapshot(documentSessionSource)
    await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    const kindOffset = documentSessionSource.indexOf('readonly kind')
    expect(kindOffset).toBeGreaterThanOrEqual(0)

    const editOffset = kindOffset + 'readonly ki'.length
    const edit = { from: editOffset, to: editOffset, text: 'g' }
    const nextSnapshot = applyBatchToPieceTable(snapshot, [edit])
    const payload = await prepareTreeEdit(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      languageId: 'typescript',
      edits: [edit],
    })
    const incremental = payload ? await editTreeDocument(workerClient, payload) : undefined
    const full = await parseTreeDocument(workerClient, {
      documentId: `${documentId}:full`,
      runtimeSessionId: `runtime-${documentId}:full`,
      snapshotVersion: 1,
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(nextSnapshot)),
    })

    expect(captureSignature(incremental?.captures ?? [])).toEqual(
      captureSignature(full?.captures ?? []),
    )
  })

  it('highlights injected script and style content', async () => {
    const documentId = 'index.html'
    const text = '<style>.x { color: red; }</style><script>const a = 1;</script>'
    const snapshot = createPieceTableSnapshot(text)
    const parsed = await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'html',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    expect(parsed?.injections.map((injection) => injection.languageId).sort()).toEqual([
      'css',
      'javascript',
    ])
    expect(parsed?.captures.some((capture) => capture.languageId === 'css')).toBe(true)
    expect(parsed?.captures.some((capture) => capture.languageId === 'javascript')).toBe(true)
  })

  it('can skip highlight captures while retaining structural results', async () => {
    const documentId = 'index.html'
    const text = [
      '<style>',
      '.x {',
      '  color: red;',
      '}',
      '</style>',
      '<script>',
      'const a = 1;',
      '</script>',
    ].join('\n')
    const snapshot = createPieceTableSnapshot(text)
    const parsed = await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'html',
      includeHighlights: false,
      includeCaptures: false,
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    expect(parsed?.captures).toEqual([])
    expect(parsed?.folds.length).toBeGreaterThan(0)
    expect(parsed?.injections.map((injection) => injection.languageId).sort()).toEqual([
      'css',
      'javascript',
    ])
  })

  it('parses a consumer-registered language id', async () => {
    const javascript = await resolveTreeSitterLanguageContribution(
      TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((contribution) => {
        return contribution.id === 'javascript'
      })!,
    )
    await workerClient.registerLanguages([
      {
        ...javascript,
        id: 'consumer-javascript',
        extensions: ['.consumer-js'],
        aliases: ['consumer-javascript'],
      },
    ])

    const text = 'const answer = 1;\n'
    const snapshot = createPieceTableSnapshot(text)
    const parsed = await parseTreeDocument(workerClient, {
      documentId: 'file.consumer-js',
      runtimeSessionId: 'runtime-file.consumer-js',
      snapshotVersion: 1,
      languageId: 'consumer-javascript',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    expect(parsed?.languageId).toBe('consumer-javascript')
    expect(parsed?.captures.length).toBeGreaterThan(0)
    expect(parsed?.captures.some((capture) => capture.languageId === 'consumer-javascript')).toBe(
      true,
    )
  })

  it('highlights injected tagged template content', async () => {
    const documentId = 'template.ts'
    const text = [
      'const view = html`<style>.x { color: red; }</style><main>${name}</main>`;',
      'const data = json`{"ok": true}`;',
    ].join('\n')
    const snapshot = createPieceTableSnapshot(text)
    const parsed = await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })
    const languages = Array.from(
      new Set(parsed?.injections.map((injection) => injection.languageId)),
    ).sort()

    expect(languages).toEqual(['css', 'html', 'json'])
    expect(parsed?.captures.some((capture) => capture.languageId === 'html')).toBe(true)
    expect(parsed?.captures.some((capture) => capture.languageId === 'css')).toBe(true)
    expect(parsed?.captures.some((capture) => capture.languageId === 'json')).toBe(true)
  })

  it('keeps injected layers active after edits outside injected content', async () => {
    const documentId = 'index.html'
    const text = '<style>.x { color: red; }</style>'
    const snapshot = createPieceTableSnapshot(text)
    await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'html',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    const edits = [{ from: text.length, to: text.length, text: '\n<main>Hello</main>' }]
    const payload = await prepareTreeEdit(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      languageId: 'html',
      edits,
    })
    const edited = payload ? await editTreeDocument(workerClient, payload) : undefined

    expect(edited?.injections.map((injection) => injection.languageId)).toContain('css')
    expect(edited?.captures.some((capture) => capture.languageId === 'css')).toBe(true)
  })

  it('updates injected layers after edits inside injected content', async () => {
    const documentId = 'index.html'
    const text = '<style>.x { color: red; }</style>'
    const snapshot = createPieceTableSnapshot(text)
    await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'html',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    const cssStart = text.indexOf('.x')
    const cssEnd = text.indexOf('</style>')
    const nextCss = '.x {\n  color: blue;\n}'
    const edits = [{ from: cssStart, to: cssEnd, text: nextCss }]
    const payload = await prepareTreeEdit(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      languageId: 'html',
      edits,
    })
    const edited = payload ? await editTreeDocument(workerClient, payload) : undefined
    const colorStart = cssStart + nextCss.indexOf('color')

    expect(edited?.injections.map((injection) => injection.languageId)).toContain('css')
    expect(
      edited?.captures.some((capture) => {
        if (capture.languageId !== 'css') return false
        if (capture.startIndex !== colorStart) return false
        return capture.endIndex === colorStart + 'color'.length
      }),
    ).toBe(true)
  })

  it('groups combined injections into one injected layer', async () => {
    const typescript = await resolveTreeSitterLanguageContribution(
      TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((contribution) => {
        return contribution.id === 'typescript'
      })!,
    )
    await workerClient.registerLanguages([
      {
        ...typescript,
        id: 'combined-typescript',
        extensions: ['.combined-ts'],
        aliases: ['combined-typescript'],
        injectionQuerySource: `
          (call_expression
            function: (identifier) @_name
            (#eq? @_name "css")
            arguments: (template_string
              (string_fragment) @injection.content)
            (#set! injection.language "css")
            (#set! injection.combined))
        `,
      },
    ])

    const text = 'const styles = css`.x { color: ${theme.color}; background: red; }`;'
    const snapshot = createPieceTableSnapshot(text)
    const parsed = await parseTreeDocument(workerClient, {
      documentId: 'style.combined-ts',
      runtimeSessionId: 'runtime-style.combined-ts',
      snapshotVersion: 1,
      languageId: 'combined-typescript',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    const cssInjections = parsed?.injections.filter((injection) => injection.languageId === 'css')
    expect(cssInjections).toHaveLength(1)
    expect(parsed?.captures.some((capture) => capture.languageId === 'css')).toBe(true)
  })

  it('matches a full parse after edits around multiple tagged-template injections', async () => {
    const text = [
      'const first = html`<section>one</section>`;',
      'const between = 1;',
      'const second = html`<aside>two</aside>`;',
    ].join('\n')
    const scenarios = [
      {
        name: 'inside',
        edit: { from: text.indexOf('one') + 1, to: text.indexOf('one') + 1, text: '!' },
      },
      {
        name: 'between',
        edit: { from: text.indexOf('between'), to: text.indexOf('between'), text: 'middle' },
      },
      { name: 'before', edit: { from: 0, to: 0, text: '// header\n' } },
    ] satisfies readonly { readonly name: string; readonly edit: TextEdit }[]

    for (const scenario of scenarios) {
      const result = await compareIncrementalInjectionsWithFullParse(workerClient, {
        documentId: `tagged-templates-${scenario.name}.ts`,
        languageId: 'typescript',
        text,
        edit: scenario.edit,
      })

      expect(result.incremental.injections.map((injection) => injection.languageId)).toEqual([
        'html',
      ])
    }
  })

  it('matches a full parse after edits around multiple markdown fences', async () => {
    const text = [
      '# Title',
      '',
      '```html',
      '<main>one</main>',
      '```',
      '',
      'Between fences.',
      '',
      '```css',
      '.two { color: red; }',
      '```',
      '',
      '```javascript',
      'const three = 3;',
      '```',
      '',
      '```html',
      '<aside>four</aside>',
      '```',
    ].join('\n')
    const scenarios = [
      {
        name: 'inside',
        edit: { from: text.indexOf('four'), to: text.indexOf('four'), text: 'number ' },
      },
      {
        name: 'between',
        edit: { from: text.indexOf('Between'), to: text.indexOf('Between'), text: 'Still ' },
      },
      { name: 'before', edit: { from: 0, to: 0, text: 'Preface\n\n' } },
    ] satisfies readonly { readonly name: string; readonly edit: TextEdit }[]

    for (const scenario of scenarios) {
      const result = await compareIncrementalInjectionsWithFullParse(workerClient, {
        documentId: `markdown-fences-${scenario.name}.md`,
        languageId: 'markdown',
        text,
        edit: scenario.edit,
      })
      const languages = new Set(
        result.incremental.injections.map((injection) => injection.languageId),
      )

      expect(languages).toEqual(
        new Set(['css', 'html', 'javascript'] satisfies TreeSitterLanguageId[]),
      )
    }
  })

  it('matches a full parse after edits that move structure outside the edited range', async () => {
    const text = [
      '# Title',
      '',
      'Some *text* here.',
      '',
      '```html',
      '<main><script>const a = 1;</script><p>after</p></main>',
      '```',
      '',
      'Closing paragraph with `code`.',
      '',
      '```css',
      '.x { color: red; }',
      '```',
    ].join('\n')
    const closeScript = text.indexOf('</script>')
    const firstFenceEnd = text.indexOf('```\n\nClosing')
    const scenarios = [
      { name: 'open-fence', edit: { from: 0, to: 0, text: '```\n' } },
      {
        name: 'drop-script-close',
        edit: { from: closeScript, to: closeScript + '</script>'.length, text: '' },
      },
      {
        name: 'drop-fence-close',
        edit: { from: firstFenceEnd, to: firstFenceEnd + 3, text: '' },
      },
      {
        name: 'retag-fence',
        edit: { from: text.indexOf('```css') + 3, to: text.indexOf('```css') + 6, text: 'js' },
      },
    ] satisfies readonly { readonly name: string; readonly edit: TextEdit }[]

    for (const scenario of scenarios) {
      await compareIncrementalInjectionsWithFullParse(workerClient, {
        documentId: `markdown-structure-${scenario.name}.md`,
        languageId: 'markdown',
        text,
        edit: scenario.edit,
      })
    }
  })

  it('matches a full parse after every step of a chain of structural markdown edits', async () => {
    let text = [
      '# Chain',
      '',
      'A paragraph with *emphasis* and `code`.',
      '',
      '```html',
      '<div><script>let x = 1;</script><style>.a{}</style></div>',
      '```',
      '',
      '- item one',
      '- item two with [link](x)',
      '',
      '```js',
      'const y = `${x}`;',
      '```',
    ].join('\n')
    const inserts = ['`', '```', '\n', '*', '<', '>', '</script>', '<script>', ' ', '# ', '- ']
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const documentId = 'markdown-chain.md'
    const runtimeSessionId = `runtime-${documentId}`
    let snapshot = createPieceTableSnapshot(text)
    await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId,
      snapshotVersion: 1,
      languageId: 'markdown',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    for (let step = 0; step < 30; step += 1) {
      const from = Math.floor(random() * text.length)
      const remove = random() < 0.3 ? Math.min(text.length - from, 1 + Math.floor(random() * 4)) : 0
      const insert =
        remove > 0 && random() < 0.5 ? '' : inserts[Math.floor(random() * inserts.length)]!
      const edit = { from, to: from + remove, text: insert }
      const nextSnapshot = applyBatchToPieceTable(snapshot, [edit])
      const payload = await prepareTreeEdit(workerClient, {
        documentId,
        runtimeSessionId,
        previousSnapshotVersion: step + 1,
        snapshotVersion: step + 2,
        languageId: 'markdown',
        edits: [edit],
      })
      const incremental = payload ? await editTreeDocument(workerClient, payload) : undefined
      text = text.slice(0, from) + insert + text.slice(from + remove)
      const full = await parseTreeDocument(workerClient, {
        documentId: `${documentId}:full-${step}`,
        runtimeSessionId: `${runtimeSessionId}:full-${step}`,
        snapshotVersion: 1,
        languageId: 'markdown',
        text: readAll(createDocumentTextSnapshot(nextSnapshot)),
      })

      expect(incremental?.injections, `step ${step}`).toEqual(full?.injections)
      expect(incremental?.captures, `step ${step}`).toEqual(full?.captures)
      retireTreeDocument(workerClient, `${runtimeSessionId}:full-${step}`)
      snapshot = nextSnapshot
    }
  })

  it('resolves all 300 paragraphs after deletes and joins without inline injection layers', async () => {
    // Headings split the document into sections, so an edit's changed range stays in its section.
    let text = Array.from({ length: 300 }, (_, index) => {
      const heading = index % 5 === 0 ? `## Part ${index}\n\n` : ''
      return `${heading}Paragraph ${index} has *emphasis*.`
    }).join('\n\n')
    const documentId = 'markdown-over-cap.md'
    const runtimeSessionId = `runtime-${documentId}`
    let snapshot = createPieceTableSnapshot(text)
    await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId,
      snapshotVersion: 1,
      languageId: 'markdown',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })
    const deleteParagraph = (index: number): TextEdit => {
      const from = text.indexOf(`Paragraph ${index} `)
      return { from, to: text.indexOf('\n\n', from) + 2, text: '' }
    }
    const joinParagraph = (index: number): TextEdit => {
      const from = text.indexOf('\n\n', text.indexOf(`Paragraph ${index} `))
      return { from, to: from + 2, text: ' ' }
    }
    const edits = [() => deleteParagraph(10), () => joinParagraph(20), () => deleteParagraph(30)]

    for (const [step, nextEdit] of edits.entries()) {
      const edit = nextEdit()
      const nextSnapshot = applyBatchToPieceTable(snapshot, [edit])
      const payload = await prepareTreeEdit(workerClient, {
        documentId,
        runtimeSessionId,
        previousSnapshotVersion: step + 1,
        snapshotVersion: step + 2,
        languageId: 'markdown',
        edits: [edit],
      })
      const incremental = payload ? await editTreeDocument(workerClient, payload) : undefined
      const full = await parseTreeDocument(workerClient, {
        documentId: `${documentId}:full-${step}`,
        runtimeSessionId: `${runtimeSessionId}:full-${step}`,
        snapshotVersion: 1,
        languageId: 'markdown',
        text: readAll(createDocumentTextSnapshot(nextSnapshot)),
      })

      expect(incremental?.injections, `step ${step}`).toEqual(full?.injections)
      expect(incremental?.captures, `step ${step}`).toEqual(full?.captures)
      expect(incremental?.injections).toHaveLength(0)
      expect(
        incremental?.captures.filter((capture) => capture.captureName === 'text.emphasis').length,
      ).toBeGreaterThan(290)
      expect(incremental?.records?.data).toEqual(full?.records?.data)
      retireTreeDocument(workerClient, `${runtimeSessionId}:full-${step}`)
      text = text.slice(0, edit.from) + edit.text + text.slice(edit.to)
      snapshot = nextSnapshot
    }
  })

  it('creates and destroys tagged-template injections incrementally', async () => {
    const incomplete = [
      'const first = html`<main>hello</main>`;',
      'const second = html`<aside>new</aside>',
    ].join('\n')
    const created = await compareIncrementalInjectionsWithFullParse(workerClient, {
      documentId: 'create-template-injection.ts',
      languageId: 'typescript',
      text: incomplete,
      edit: { from: incomplete.length, to: incomplete.length, text: '`' },
    })

    expect(created.initial.injections.map((injection) => injection.languageId)).toEqual(['html'])
    expect(created.incremental.injections.map((injection) => injection.languageId)).toEqual([
      'html',
    ])

    const complete = [
      'const first = html`<main>hello</main>`;',
      'const second = html`<aside>old</aside>`;',
    ].join('\n')
    const secondTag = complete.lastIndexOf('html')
    const destroyed = await compareIncrementalInjectionsWithFullParse(workerClient, {
      documentId: 'destroy-template-injection.ts',
      languageId: 'typescript',
      text: complete,
      edit: { from: secondTag, to: secondTag + 'html'.length, text: '' },
    })

    expect(destroyed.initial.injections.map((injection) => injection.languageId)).toEqual(['html'])
    expect(destroyed.incremental.injections.map((injection) => injection.languageId)).toEqual([
      'html',
    ])
  })

  it('matches a full parse after an edit inside a nested markdown-html-script injection', async () => {
    const text = [
      '# Nested',
      '',
      '```html',
      '<main><script>const value = 1;</script></main>',
      '```',
    ].join('\n')
    const valueIndex = text.indexOf('1;')
    const result = await compareIncrementalInjectionsWithFullParse(workerClient, {
      documentId: 'nested-markdown-injection.md',
      languageId: 'markdown',
      text,
      edit: { from: valueIndex, to: valueIndex + 1, text: '2' },
    })
    const languages = new Set(
      result.incremental.injections.map((injection) => injection.languageId),
    )

    expect(languages).toEqual(new Set(['html', 'javascript']))
  })

  it('expands and shrinks structural selections through the cached syntax tree', async () => {
    const documentId = 'file.ts'
    const snapshot = createPieceTableSnapshot('const answer = 1;\n')
    await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'typescript',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    const selections = createSelectionSet([createAnchorSelection(snapshot, 7)])
    const token = await selectTreeSitterToken({
      backend: workerClient,
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      languageId: 'typescript',
      snapshotVersion: 1,
      snapshot,
      selections,
    })
    const expanded = await expandTreeSitterSelection({
      backend: workerClient,
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      languageId: 'typescript',
      snapshotVersion: 1,
      snapshot,
      selections: token.selections,
      state: token.state,
    })
    const shrunk = shrinkTreeSitterSelection({
      backend: workerClient,
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      languageId: 'typescript',
      snapshotVersion: 1,
      snapshot,
      selections: expanded.selections,
      state: expanded.state,
    })

    const tokenRange = resolveSelection(snapshot, token.selections.selections[0]!)
    const expandedRange = resolveSelection(snapshot, expanded.selections.selections[0]!)
    const shrunkRange = resolveSelection(snapshot, shrunk.selections.selections[0]!)
    expect(tokenRange).toMatchObject({ startOffset: 6, endOffset: 12 })
    expect(expandedRange.endOffset - expandedRange.startOffset).toBeGreaterThan(6)
    expect(shrunkRange).toMatchObject({ startOffset: 6, endOffset: 12 })
  })

  it('selects tokens inside injected content through the injected layer', async () => {
    const documentId = 'index.html'
    const text = '<style>.x { color: red; }</style>'
    const snapshot = createPieceTableSnapshot(text)
    await parseTreeDocument(workerClient, {
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      snapshotVersion: 1,
      languageId: 'html',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })

    const offset = text.indexOf('color')
    const selections = createSelectionSet([createAnchorSelection(snapshot, offset)])
    const token = await selectTreeSitterToken({
      backend: workerClient,
      documentId,
      runtimeSessionId: `runtime-${documentId}`,
      languageId: 'html',
      snapshotVersion: 1,
      snapshot,
      selections,
    })

    const tokenRange = resolveSelection(snapshot, token.selections.selections[0]!)
    expect(tokenRange).toMatchObject({ startOffset: offset, endOffset: offset + 'color'.length })
  })
})

async function registerDefaultLanguages(workerClient: TreeSitterWorkerClient): Promise<void> {
  const descriptors = await Promise.all(
    TREE_SITTER_LANGUAGE_CONTRIBUTIONS.map(resolveTreeSitterLanguageContribution),
  )
  await workerClient.registerLanguages(descriptors)
}

type CaptureSignatureInput = {
  readonly startIndex: number
  readonly endIndex: number
  readonly captureName: string
  readonly languageId?: string
}

function captureSignature(captures: readonly CaptureSignatureInput[]): string[] {
  return captures
    .map((capture) => {
      const languageId = capture.languageId ?? ''
      return `${capture.startIndex}:${capture.endIndex}:${capture.captureName}:${languageId}`
    })
    .sort()
}

function packedTokensCoverRange(
  tokens: { readonly starts: Uint32Array; readonly ends: Uint32Array } | undefined,
  startIndex: number,
  endIndex: number,
): boolean {
  if (!tokens) return false
  return tokens.starts.some(
    (start, index) => start <= startIndex && tokens.ends[index]! >= endIndex,
  )
}

type IncrementalInjectionScenario = {
  readonly documentId: string
  readonly languageId: TreeSitterLanguageId
  readonly text: string
  readonly edit: TextEdit
}

async function compareIncrementalInjectionsWithFullParse(
  workerClient: TreeSitterWorkerClient,
  scenario: IncrementalInjectionScenario,
) {
  const snapshot = createPieceTableSnapshot(scenario.text)
  const initial = await parseTreeDocument(workerClient, {
    documentId: scenario.documentId,
    runtimeSessionId: `runtime-${scenario.documentId}`,
    snapshotVersion: 1,
    languageId: scenario.languageId,
    text: readAll(createDocumentTextSnapshot(snapshot)),
  })
  if (!initial) throw new Error(`Initial parse failed for ${scenario.documentId}`)

  const nextSnapshot = applyBatchToPieceTable(snapshot, [scenario.edit])
  const payload = await prepareTreeEdit(workerClient, {
    documentId: scenario.documentId,
    runtimeSessionId: `runtime-${scenario.documentId}`,
    previousSnapshotVersion: 1,
    snapshotVersion: 2,
    languageId: scenario.languageId,
    edits: [scenario.edit],
  })
  if (!payload) throw new Error(`Edit payload failed for ${scenario.documentId}`)

  const incremental = await editTreeDocument(workerClient, payload)
  if (!incremental) throw new Error(`Incremental parse failed for ${scenario.documentId}`)

  const full = await parseTreeDocument(workerClient, {
    documentId: `${scenario.documentId}:full`,
    runtimeSessionId: `runtime-${scenario.documentId}:full`,
    snapshotVersion: 1,
    languageId: scenario.languageId,
    text: readAll(createDocumentTextSnapshot(nextSnapshot)),
  })
  if (!full) throw new Error(`Full parse failed for ${scenario.documentId}`)

  expect(incremental.captures).toEqual(full.captures)
  expect(incremental.tokensPacked).toEqual(full.tokensPacked)
  expect(incremental.injections).toEqual(full.injections)
  return { initial, incremental, full }
}

describe('real tree-sitter retention', () => {
  const clients = new Set<TreeSitterWorkerClient>()
  const client = () => {
    const owner = new TreeSitterWorkerClient()
    clients.add(owner)
    return owner
  }

  afterEach(async () => {
    await Promise.all(Array.from(clients, (owner) => owner.dispose()))
    clients.clear()
  })

  it('retention inspection leaves an unstarted or disposed worker absent', async () => {
    const owner = client()
    expect(await owner.inspectRetention()).toBeNull()
    await owner.awaitIdleFence()
    expect(owner.inspect()).toMatchObject({ lifecycle: 'idle', workerGeneration: 0 })
    await owner.dispose()
    expect(await owner.inspectRetention()).toBeNull()
    expect(owner.inspect()).toMatchObject({ lifecycle: 'disposed', workerGeneration: 0 })
  })
})

describe('fenced tree-sitter retention', () => {
  let owner: TreeSitterWorkerClient

  beforeEach(() => {
    owner = new TreeSitterWorkerClient()
  })
  afterEach(async () => {
    await owner.dispose()
  })

  const retention = async (): Promise<TreeSitterWorkerRetentionSnapshot> => {
    const result = await owner.inspectRetention()
    if (!result) throw new TypeError('Expected a live worker retention snapshot')
    return result
  }

  const register = async () => {
    const descriptors = await Promise.all(
      TREE_SITTER_LANGUAGE_CONTRIBUTIONS.map(resolveTreeSitterLanguageContribution),
    )
    await owner.registerLanguages(descriptors)
    return descriptors
  }

  it('retention counts actual parser snapshots and their retained ordinary reads', async ({
    annotate,
  }) => {
    await register()
    const firstText = 'const first = 1;\n'
    const nextText = 'const next = 2;\n'
    const request = {
      documentId: 'shared.ts',
      runtimeSessionId: 'retained',
      languageId: 'typescript',
    }
    const first = parseTreeDocument(owner, {
      ...request,
      snapshotVersion: 1,
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(firstText))),
    })
    expect((await first)?.tokensPacked?.starts.length).toBeGreaterThan(0)
    const firstRetention = await retention()
    expect(firstRetention).toMatchObject({ documentCount: 1, snapshotCount: 1, treeCount: 1 })
    expect(firstRetention.source).toEqual({
      documentCount: 1,
      readCount: 1,
      pinCount: 0,
      sourceUnits: firstText.length,
    })

    await parseTreeDocument(owner, {
      ...request,
      snapshotVersion: 2,
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(nextText))),
    })
    const both = await retention()
    expect(both).toMatchObject({
      documentCount: 1,
      snapshotCount: 2,
      treeCount: 2,
      markdownDocumentCount: 0,
    })
    expect(both.source).toEqual({
      documentCount: 1,
      readCount: 2,
      pinCount: 0,
      sourceUnits: firstText.length + nextText.length,
    })
    expect(both.documents).toEqual([
      {
        runtimeSessionId: 'retained',
        snapshots: [
          {
            snapshotVersion: 2,
            languageId: 'typescript',
            sourceUnits: nextText.length,
            layerCount: 1,
            treeCount: 1,
            markdownDocumentCount: 0,
          },
          {
            snapshotVersion: 1,
            languageId: 'typescript',
            sourceUnits: firstText.length,
            layerCount: 1,
            treeCount: 1,
            markdownDocumentCount: 0,
          },
        ],
      },
    ])
    expect(both.unmeasuredBytes).toContain('wasm-allocator-live')
    expect(JSON.stringify(both)).not.toContain(firstText)
    expect(JSON.stringify(both)).not.toContain('shared.ts')

    retireTreeDocument(owner, 'retained')
    const released = await retention()
    expect(released).toMatchObject({
      documentCount: 0,
      snapshotCount: 0,
      treeCount: 0,
      markdownDocumentCount: 0,
    })
    expect(released.source).toEqual({
      documentCount: 0,
      readCount: 0,
      pinCount: 0,
      sourceUnits: 0,
    })
    expect(released.shared).toEqual(both.shared)
    await annotate('snapshot and source resource counts', {
      contentType: 'application/json',
      bodyEncoding: 'utf-8',
      body: JSON.stringify({ firstRetention, both, released }),
    })
  })

  it('retention fences empty, pending, disposed and recreated documents over 40 shared-client cycles', async ({
    annotate,
  }) => {
    const descriptors = await register()
    const descriptor = descriptors.find((language) => language.id === 'typescript')
    if (!descriptor) throw new TypeError('Expected the TypeScript fixture grammar')
    await owner.warmLanguages([
      { ...descriptor, id: 'broken', wasmUrl: 'data:application/wasm;base64,AA==' },
    ])
    const warm = await retention()
    expect(warm).toMatchObject({ documentCount: 0, snapshotCount: 0, treeCount: 0 })
    expect(warm.shared).toMatchObject({
      wasmMemory: { kind: 'committed' },
      runtimeEntries: 1,
      runtimeCount: 0,
      parserCount: 0,
      languageCount: 0,
      queryCount: 0,
    })
    const snapshot = createPieceTableSnapshot('const survivor = true;\n')
    const request = { documentId: 'shared.ts', languageId: 'typescript', snapshotVersion: 1 }
    const survivor = await parseTreeDocument(owner, {
      ...request,
      runtimeSessionId: 'survivor',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })
    expect(survivor?.captures.length).toBeGreaterThan(0)
    const baseline = await retention()
    expect(baseline).toMatchObject({ documentCount: 1, snapshotCount: 1, treeCount: 1 })
    expect(baseline.shared).toMatchObject({
      runtimeEntries: 2,
      runtimeCount: 1,
      parserCount: 1,
      languageCount: 1,
    })
    expect(baseline.shared.queryCount).toBeGreaterThan(0)
    const acquisitions = []
    const samples = []
    for (let cycle = 0; cycle < 40; cycle++) {
      const runtimeSessionId = `cycle-${cycle}`
      const pending = parseTreeDocument(owner, {
        ...request,
        runtimeSessionId,
        text: readAll(
          createDocumentTextSnapshot(cycle === 0 ? createPieceTableSnapshot('') : snapshot),
        ),
      })
      expect(await pending).toBeDefined()
      const retained = await retention()
      acquisitions.push(retained)
      expect(retained).toMatchObject({ documentCount: 2, snapshotCount: 2, treeCount: 2 })
      expect(retained.source.sourceUnits).toBe(cycle === 0 ? snapshot.length : 2 * snapshot.length)
      retireTreeDocument(owner, runtimeSessionId)
      samples.push(await retention())
    }
    expect(samples).toEqual(Array.from({ length: 40 }, () => baseline))
    const pending = parseTreeDocument(owner, {
      ...request,
      runtimeSessionId: 'pending-disposal',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })
    const canceled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    retireTreeDocument(owner, 'pending-disposal')
    await canceled
    expect(await retention()).toEqual(baseline)
    const recreated = await parseTreeDocument(owner, {
      ...request,
      runtimeSessionId: 'recreated',
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })
    expect(recreated?.tokensPacked).toEqual(survivor?.tokensPacked)
    retireTreeDocument(owner, 'recreated')
    expect(await retention()).toEqual(baseline)
    const surviving = await owner.queryRange({
      ...request,
      runtimeSessionId: 'survivor',
      includeCaptures: true,
      range: { startIndex: 0, endIndex: snapshot.length },
    })
    expect(surviving?.tokensPacked).toEqual(survivor?.tokensPacked)
    retireTreeDocument(owner, 'survivor')
    const released = await retention()
    expect(released).toMatchObject({
      documentCount: 0,
      snapshotCount: 0,
      treeCount: 0,
      markdownDocumentEntries: 0,
      markdownDocumentCount: 0,
      injectedMarkdownDocumentCount: 0,
    })
    expect(released.source).toEqual({
      documentCount: 0,
      readCount: 0,
      pinCount: 0,
      sourceUnits: 0,
    })
    expect(released.shared).toEqual(baseline.shared)
    await owner.dispose()
    expect(await owner.inspectRetention()).toBeNull()
    expect(owner.inspect().workerGeneration).toBe(1)
    await annotate('all 40 fenced resource samples', {
      contentType: 'application/json',
      bodyEncoding: 'utf-8',
      body: JSON.stringify({ warm, baseline, acquisitions, samples, released }),
    })
  })

  it('retention counts root and injected Markdown wrappers separately from layer trees', async ({
    annotate,
  }) => {
    await register()
    const text = '~~~mdx\n# Nested **heading**\n~~~\n'
    const parsed = await parseTreeDocument(owner, {
      documentId: 'nested.md',
      runtimeSessionId: 'markdown',
      languageId: 'markdown',
      snapshotVersion: 1,
      text: readAll(createDocumentTextSnapshot(createPieceTableSnapshot(text))),
    })
    expect(parsed?.injections.some((injection) => injection.languageId === 'mdx')).toBe(true)
    expect(parsed?.records?.data.length).toBeGreaterThan(0)
    const retained = await retention()
    expect(retained).toMatchObject({
      documentCount: 1,
      snapshotCount: 1,
      treeCount: 1,
      markdownDocumentEntries: 1,
      markdownDocumentCount: 2,
      injectedMarkdownDocumentCount: 1,
    })
    expect(retained.documents[0]?.snapshots).toEqual([
      {
        snapshotVersion: 1,
        languageId: 'markdown',
        sourceUnits: text.length,
        layerCount: 1,
        treeCount: 1,
        markdownDocumentCount: 2,
      },
    ])
    expect(retained.shared).toMatchObject({ runtimeCount: 1, parserCount: 1, languageCount: 1 })
    expect(retained.unmeasuredResources).toContain('markdown-tree-handles')
    retireTreeDocument(owner, 'markdown')
    const empty = await retention()
    expect(empty).toMatchObject({
      documentCount: 0,
      snapshotCount: 0,
      treeCount: 0,
      markdownDocumentEntries: 0,
      markdownDocumentCount: 0,
      injectedMarkdownDocumentCount: 0,
    })
    expect(empty.shared).toEqual(retained.shared)
    await annotate('Markdown resource counts', {
      contentType: 'application/json',
      bodyEncoding: 'utf-8',
      body: JSON.stringify({ retained, empty }),
    })
  })
})

it('retention keeps ordinary real-worker fences unchanged and leaves parser initialization absent', async () => {
  const worker = new Worker(new URL('../src/treeSitter/treeSitter.worker.ts', import.meta.url), {
    type: 'module',
  })
  let id = 0
  const request = (payload: TreeSitterWorkerRequestPayload): Promise<TreeSitterWorkerResponse> =>
    new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<TreeSitterWorkerResponse>) => resolve(event.data)
      worker.onerror = reject
      worker.postMessage({ id: ++id, payload })
    })
  try {
    const ordinary = await request({ type: 'idleFence' })
    expect(ordinary).toEqual({ id: 1, ok: true, result: undefined })
    const inspected = await request({ type: 'idleFence', includeRetention: true })
    if (!inspected.ok || !inspected.result || !('retention' in inspected.result))
      throw new TypeError('Expected a real-worker retention reply')
    expect(inspected.result.retention).toMatchObject({
      documentCount: 0,
      snapshotCount: 0,
      treeCount: 0,
      shared: {
        wasmMemory: { kind: 'uninitialized' },
        runtimeEntries: 0,
        runtimeCount: 0,
        parserCount: 0,
        languageCount: 0,
        queryCount: 0,
      },
    })
    expect(await request({ type: 'idleFence' })).toEqual({ id: 3, ok: true, result: undefined })
  } finally {
    worker.terminate()
  }
})

it('retention observes shared provider acquisition and late registration after a session is disposed', async () => {
  const owner = createTreeSitterWorkerOwner()
  const provider = createTreeSitterSyntaxProvider({ workerOwner: owner })
  const contribution = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find(
    (language) => language.id === 'typescript',
  )
  if (!contribution) throw new TypeError('Expected the TypeScript fixture language')
  provider.registerLanguage(contribution)
  const descriptor = await resolveTreeSitterLanguageContribution(contribution)
  const releases: ((value: typeof descriptor) => void)[] = []
  const registration = new Promise<typeof descriptor>((resolve) => releases.push(resolve))
  provider.registerLanguage({ id: 'late-typescript', load: () => registration })
  const snapshot = createPieceTableSnapshot('const value = true;\n')
  const textSnapshot = createDocumentTextSnapshot(snapshot)
  const acquire = (_label: string, languageId = 'typescript') => {
    const buffer = createEditorTextBuffer(readAll(textSnapshot))
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'shared.ts' })
    const session = analysis.borrowStructural({ provider, languageId, syntaxMode: 'full' })
    if (!session) {
      analysis.dispose()
      throw new TypeError('The fixture language must bind a real operation')
    }
    return {
      ...session,
      dispose: () => {
        session.dispose()
        analysis.dispose()
      },
    }
  }
  const survivor = acquire('provider-survivor')
  const pending = acquire('provider-pending', 'late-typescript')
  const late = expect(pending.refresh(textSnapshot)).rejects.toMatchObject({ name: 'AbortError' })
  pending.dispose()
  try {
    const initial = await survivor.refresh(textSnapshot)
    expect(initial.tokens?.length).toBeGreaterThan(0)
    const baseline = await owner.inspectRetention()
    expect(baseline?.documents.map((document) => document.runtimeSessionId)).toEqual([
      survivor.runtimeSessionId,
    ])
    for (const release of releases) release(descriptor)
    await late
    const afterLate = await owner.inspectRetention()
    expect(afterLate?.documents).toEqual(baseline?.documents)
    expect(afterLate?.source).toEqual(baseline?.source)
    const first = acquire('provider-first')
    await first.refresh(textSnapshot)
    first.dispose()
    expect((await owner.inspectRetention())?.documents).toEqual(baseline?.documents)
    const recreated = acquire('provider-recreated')
    const next = await recreated.refresh(textSnapshot)
    expect(toEditorTokenStore(next.tokens).toTokens()).toEqual(
      toEditorTokenStore(initial.tokens).toTokens(),
    )
    expect(next.captures).toEqual(initial.captures)
    expect(next.folds).toEqual(initial.folds)
    expect(next.errors).toEqual(initial.errors)
    recreated.dispose()
    expect((await owner.inspectRetention())?.documents).toEqual(baseline?.documents)
    survivor.dispose()
    expect(await owner.inspectRetention()).toMatchObject({
      documentCount: 0,
      snapshotCount: 0,
      treeCount: 0,
    })
  } finally {
    for (const release of releases) release(descriptor)
    pending.dispose()
    survivor.dispose()
    await owner.dispose()
  }
})

it('retention settles pending startup after owner disposal without recreating a worker', async () => {
  const owner = new TreeSitterWorkerClient()
  const contribution = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find(
    (language) => language.id === 'typescript',
  )
  if (!contribution) throw new TypeError('Expected the TypeScript fixture language')
  const descriptor = await resolveTreeSitterLanguageContribution(contribution)
  const startup = owner.registerLanguages([descriptor])
  const settledStartup = startup.catch((error: unknown) => error)
  const inspection = owner.inspectRetention()
  await owner.dispose()
  expect(await settledStartup).toBeInstanceOf(Error)
  expect(await inspection).toBeNull()
  expect(await owner.inspectRetention()).toBeNull()
  expect(owner.inspect()).toMatchObject({
    lifecycle: 'disposed',
    workerGeneration: 1,
    pendingRequests: 0,
  })
})
