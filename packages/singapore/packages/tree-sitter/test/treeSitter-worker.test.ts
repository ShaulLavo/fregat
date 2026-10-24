import { afterEach, describe, expect, it } from 'vitest'
import type { Node, Query, Range as TreeSitterRange, Tree } from 'web-tree-sitter'

import {
  DocumentWorkerReader,
  type DocumentWorkerReadReference,
} from '@singapore-editor/core/internal/document-worker'
import { createTreeSitterInput, readTreeSitterInputRange } from '../src/treeSitter/source.ts'
import { __treeSitterWorkerInternalsForTests } from '../src/treeSitter/treeSitter.worker.ts'

const {
  applyTextEdit,
  applyTextEdits,
  appendItems,
  collectBracket,
  collectCaptures,
  collectError,
  collectTreeData,
  rangeSpan,
  readTreeSitterPieceTableInput,
  replaceCachedDocument,
  reusableParsedDocument,
  disposeDocument,
} = __treeSitterWorkerInternalsForTests

describe('tree-sitter worker internals', () => {
  it('retains phase timings when a stale request cancels', async () => {
    const result = await __treeSitterWorkerInternalsForTests.runCancellableRequest(
      {
        type: 'parse',
        documentId: 'worker-fixture',
        runtimeSessionId: 'superseded-fixture',
        languageId: 'typescript',
        snapshotVersion: 1,
        generation: 1,
        includeHighlights: false,
        source: messageSource,
      },
      async (context) => {
        context.measurements?.set('parseRoot', 12)
        context.counts?.set('parseSlices', 2)
        __treeSitterWorkerInternalsForTests.assertNotCancelled(context)
        return undefined
      },
    )
    expect(result).toMatchObject({
      status: 'cancelled',
      analysis: { kind: 'cancelled', reason: 'superseded' },
      timings: [{ name: 'treeSitter.parseRoot', durationMs: 12 }],
      statistics: { parseSlices: 2 },
    })
  })

  it('reports an exhausted work budget as a structured outcome', () => {
    const result = __treeSitterWorkerInternalsForTests.cancellationAnalysis({
      startedAt: performance.now() - 21_000,
      budgetMs: 20_000,
      flag: null,
      measurements: new Map([['parseRoot', 19_000]]),
    })
    expect(result).toMatchObject({
      kind: 'cancelled',
      reason: 'budget',
      budgetMs: 20_000,
      timings: [{ name: 'treeSitter.parseRoot', durationMs: 19_000 }],
    })
    expect(result.elapsedMs).toBeGreaterThanOrEqual(21_000)
  })

  it('applies text edits by replacing the old range', () => {
    expect(applyTextEdit('const a = 1;', 6, 7, 'answer')).toBe('const answer = 1;')
    expect(applyTextEdit('abcdef', 2, 4, '')).toBe('abef')
    expect(applyTextEdit('abef', 2, 2, 'cd')).toBe('abcdef')
  })

  it('applies batch text edits from the original offsets', () => {
    expect(
      applyTextEdits('ab\ncd', [
        { from: 0, to: 1, text: 'x' },
        { from: 3, to: 5, text: 'yz' },
      ]),
    ).toBe('xb\nyz')
  })

  it('reads parser input through the ordinary bounded reader', () => {
    const input = inputFromText('a😀\ntail')
    expect(readTreeSitterPieceTableInput(input, 0)).toBe('a😀\ntail')
    expect(readTreeSitterPieceTableInput(input, 4)).toBe('tail')
    expect(readTreeSitterPieceTableInput(input, input.length)).toBeUndefined()
    expect(readTreeSitterInputRange(input, 1, input.length)).toBe('😀\ntail')
  })

  it('caps parser input reads to fit the web-tree-sitter UTF-16 callback buffer', () => {
    const input = inputFromText('a'.repeat(10_000))
    expect(readTreeSitterPieceTableInput(input, 0)).toHaveLength(4096)
    expect(readTreeSitterPieceTableInput(input, 4096)).toHaveLength(4096)
    expect(readTreeSitterPieceTableInput(input, 8192)).toHaveLength(1808)
  })

  it('reads an empty ordinary source', () => {
    expect(readTreeSitterPieceTableInput(inputFromText(''), 0)).toBeUndefined()
  })

  it('tracks bracket depth while walking open and close nodes', () => {
    const stack: { char: string; index: number }[] = []

    expect(collectBracket(node('(', 0), stack)).toEqual({ index: 0, char: '(', depth: 1 })
    expect(collectBracket(node('{', 1), stack)).toEqual({ index: 1, char: '{', depth: 2 })
    expect(collectBracket(node('}', 2), stack)).toEqual({ index: 2, char: '}', depth: 2 })
    expect(collectBracket(node(')', 3), stack)).toEqual({ index: 3, char: ')', depth: 1 })
    expect(stack).toEqual([])
  })

  it('reports tree-sitter error and missing nodes', () => {
    expect(collectError(node('ERROR', 4, 9, { isError: true }))).toEqual({
      startIndex: 4,
      endIndex: 9,
      isMissing: false,
      message: 'ERROR',
    })

    expect(collectError(node('identifier', 10, 10, { isMissing: true }))).toEqual({
      startIndex: 10,
      endIndex: 10,
      isMissing: true,
      message: 'identifier',
    })

    expect(collectError(node('identifier', 0, 10))).toBeNull()
  })

  it.each([
    ['identifier', false, false],
    ['(', false, true],
    [')', false, true],
    ['ERROR', false, true],
    ['identifier', true, true],
  ] as const)(
    'reads cursor diagnostics once and delays offsets for %s',
    (type, missing, needsStart) => {
      const reads = { type: 0, isMissing: 0, startIndex: 0, endIndex: 0 }
      const root = node(type, 4, 9, { isMissing: missing })
      for (const [field, value] of Object.entries({
        type,
        isMissing: missing,
        startIndex: 4,
        endIndex: 9,
      })) {
        Object.defineProperty(root, field, {
          get: () => {
            reads[field as keyof typeof reads]++
            return value
          },
        })
      }
      const result = collectTreeData(fakeTree(root))
      const isError = type === 'ERROR' || missing
      expect(result.errors).toEqual(
        isError ? [{ startIndex: 4, endIndex: 9, isMissing: missing, message: type }] : [],
      )
      expect(result.brackets).toEqual(
        type === '(' || type === ')' ? [{ index: 4, char: type, depth: 1 }] : [],
      )
      expect(reads).toEqual({
        type: 1,
        isMissing: 1,
        startIndex: needsStart ? 1 : 0,
        endIndex: isError ? 1 : 0,
      })
    },
  )

  it.each([undefined, { startIndex: 0, endIndex: 100 }])(
    'keeps brackets and skips missing-node checks on an error-free tree for range %j',
    (range) => {
      const children = [node('(', 1), node('identifier', 2, 3), node(')', 4)]
      const root = Object.assign(node('program', 0, 100), { children })
      let missingReads = 0
      for (const current of [root].concat(children)) {
        Object.defineProperty(current, 'isMissing', {
          get: () => {
            missingReads++
            return false
          },
        })
      }
      expect(collectTreeData(fakeTree(root, false), range)).toEqual({
        brackets: [
          { index: 1, char: '(', depth: 1 },
          { index: 4, char: ')', depth: 1 },
        ],
        errors: [],
      })
      expect(missingReads).toBe(0)
    },
  )

  it('walks deeply nested trees without recursive stack overflow', () => {
    const root = nestedNode(12_000)

    expect(collectTreeData(fakeTree(root)).errors).toHaveLength(1)
  })

  it('keeps nested diagnostics and bracket depths inside a middle range', () => {
    const nested = Object.assign(node('block', 20, 40), {
      children: [
        node('{', 21),
        node('ERROR', 26, 27, { isError: true }),
        node('}', 28),
        node('ERROR', 31, 32, { isError: true }),
      ],
    })
    const root = Object.assign(node('document', 0, 100), {
      children: [node('ERROR', 1, 2, { isError: true }), nested, node('identifier', 50, 60)],
    })

    expect(collectTreeData(fakeTree(root), { startIndex: 20, endIndex: 30 })).toEqual({
      brackets: [
        { index: 21, char: '{', depth: 1 },
        { index: 28, char: '}', depth: 1 },
      ],
      errors: [{ startIndex: 26, endIndex: 27, isMissing: false, message: 'ERROR' }],
    })
  })

  it('stops a range walk before the trailing document siblings', () => {
    let trailingReads = 0
    const trailing = node('ERROR', 20, 100, { isError: true })
    Object.defineProperty(trailing, 'endIndex', {
      get() {
        trailingReads += 1
        return 100
      },
    })
    const root = Object.assign(node('document', 0, 100), {
      children: [node('ERROR', 1, 2, { isError: true }), node('identifier', 10, 11), trailing],
    })

    const result = collectTreeData(fakeTree(root), { startIndex: 0, endIndex: 10 })

    expect(result.errors).toEqual([
      { startIndex: 1, endIndex: 2, isMissing: false, message: 'ERROR' },
    ])
    expect(trailingReads).toBe(0)
  })

  it('returns empty diagnostics when tree-sitter provides no tree cursor', () => {
    expect(collectTreeData(null)).toEqual({ brackets: [], errors: [] })
    expect(collectTreeData({ walk: () => null } as unknown as Tree)).toEqual({
      brackets: [],
      errors: [],
    })
  })

  it('appends large worker result arrays without spreading call arguments', () => {
    const items = Array.from({ length: 200_000 }, (_, index) => index)
    const target: number[] = []

    appendItems(target, items)

    expect(target).toHaveLength(items.length)
    expect(target.at(-1)).toBe(199_999)
  })

  it('spans large injection range arrays without spreading call arguments', () => {
    const ranges = Array.from({ length: 200_000 }, (_, index) =>
      treeSitterRange(index * 2, index * 2 + 1),
    )

    expect(rangeSpan(ranges)).toEqual({ startIndex: 0, endIndex: 399_999 })
  })

  it('collects range highlights from captures that intersect the visible range', () => {
    const highlightedNode = node('identifier', 75, 82)
    const query = {
      matches: () => [],
      captures: (_root: Node, options?: NonNullable<Parameters<Query['captures']>[1]>) => {
        expect(options?.startIndex).toBe(140)
        expect(options?.endIndex).toBe(180)
        return [{ name: 'variable', node: highlightedNode }]
      },
    } as unknown as Query
    const runtime = highlightedRuntime(query)
    const context = cancellationContext()

    expect(
      collectCaptures(fakeTree(node('program', 0, 100)), runtime, context, {
        startIndex: 70,
        endIndex: 90,
      }),
    ).toEqual([
      {
        startIndex: 75,
        endIndex: 82,
        captureName: 'variable',
        languageId: 'typescript',
      },
    ])
  })

  it('groups full captures by span and preserves first-capture precedence within equal spans', () => {
    const ranges = [
      { name: 'variable', startIndex: 75, endIndex: 82, patternIndex: 0 },
      { name: 'function', startIndex: 5, endIndex: 10, patternIndex: 1 },
      { name: 'variable', startIndex: 75, endIndex: 82, patternIndex: 2 },
      { name: 'function', startIndex: 75, endIndex: 82, patternIndex: 3 },
      { name: 'empty', startIndex: 3, endIndex: 3, patternIndex: 4 },
      { name: 'variable', startIndex: 5, endIndex: 10, patternIndex: 5 },
      { name: 'variable', startIndex: 75, endIndex: 83, patternIndex: 6 },
      { name: 'variable', startIndex: 75, endIndex: 82, patternIndex: 7 },
      { name: 'inverted', startIndex: 6, endIndex: 4, patternIndex: 8 },
    ]
    const query = { captureRanges: () => ranges.slice() } as unknown as Query
    const context = { ...cancellationContext(), counts: new Map<string, number>() }
    expect(
      collectCaptures(fakeTree(node('program', 0, 100)), highlightedRuntime(query), context),
    ).toEqual([
      { startIndex: 5, endIndex: 10, captureName: 'function', languageId: 'typescript' },
      { startIndex: 5, endIndex: 10, captureName: 'variable', languageId: 'typescript' },
      { startIndex: 75, endIndex: 82, captureName: 'variable', languageId: 'typescript' },
      { startIndex: 75, endIndex: 82, captureName: 'function', languageId: 'typescript' },
      { startIndex: 75, endIndex: 83, captureName: 'variable', languageId: 'typescript' },
    ])
    expect(context.counts.get('rawCaptures')).toBe(9)
    expect(context.counts.get('uniqueCaptures')).toBe(5)
    expect(ranges.map((capture) => capture.patternIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('deduplicates full captures independently for each language and query invocation', () => {
    const query = {
      captureRanges: () => [
        { name: 'string', startIndex: 5, endIndex: 10, patternIndex: 0 },
        { name: 'string', startIndex: 5, endIndex: 10, patternIndex: 1 },
      ],
    } as unknown as Query
    const tree = fakeTree(node('program', 0, 100))
    for (const languageId of ['typescript', 'javascript'] as const) {
      const base = highlightedRuntime(query)
      const runtime = { ...base, descriptor: { ...base.descriptor, id: languageId } }
      for (let repetition = 0; repetition < 2; repetition++) {
        expect(collectCaptures(tree, runtime, cancellationContext())).toEqual([
          { startIndex: 5, endIndex: 10, captureName: 'string', languageId },
        ])
      }
    }
  })

  it('returns no full captures when every span is empty or inverted', () => {
    const query = {
      captureRanges: () => [
        { name: 'string', startIndex: 5, endIndex: 5, patternIndex: 0 },
        { name: 'string', startIndex: 10, endIndex: 5, patternIndex: 1 },
      ],
    } as unknown as Query
    const context = { ...cancellationContext(), counts: new Map<string, number>() }
    expect(
      collectCaptures(fakeTree(node('program', 0, 100)), highlightedRuntime(query), context),
    ).toEqual([])
    expect(context.counts.get('rawCaptures')).toBe(2)
    expect(context.counts.get('uniqueCaptures')).toBe(0)
  })

  it('skips highlights when tree-sitter provides null trees or capture nodes', () => {
    const query = {
      captureRanges: () => [],
      captures: () => [{ name: 'variable', node: null }],
    } as unknown as Query
    const runtime = highlightedRuntime(query)
    const context = cancellationContext()

    expect(collectCaptures(null, runtime, context)).toEqual([])
    expect(collectCaptures(fakeTree(node('program', 0, 100)), runtime, context)).toEqual([])
    expect(
      collectCaptures(fakeTree(node('program', 0, 100)), runtime, context, {
        startIndex: 0,
        endIndex: 100,
      }),
    ).toEqual([])
  })
})

const sourceCleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of sourceCleanup.splice(0)) dispose()
})
const messageSource: DocumentWorkerReadReference = {
  identity: {
    documentId: 'worker-fixture',
    documentGeneration: 1,
    endpointGeneration: 1,
    registrationId: 1,
  },
  point: { segment: 'worker-fixture', revision: 0, textVersion: 0 },
  readId: 'worker-fixture',
}
function inputFromText(text: string) {
  const reader = new DocumentWorkerReader()
  const { identity, point } = messageSource
  reader.apply({ kind: 'register', identity })
  reader.apply({
    kind: 'reset',
    identity,
    base: null,
    target: point,
    chunks: [text],
    lineEnding: '\n',
    byteOrderMark: '',
    containsUnusualLineTerminators: false,
  })
  const loan = reader.acquire({ identity, point })!
  const input = createTreeSitterInput(loan)
  sourceCleanup.push(() => {
    input.dispose()
    reader.dispose()
  })
  return input
}

type TestNode = Node & {
  readonly children: readonly TestNode[]
}

function node(
  type: string,
  startIndex: number,
  endIndex = startIndex + 1,
  flags: Partial<Pick<Node, 'isError' | 'isMissing'>> = {},
): TestNode {
  return {
    children: [],
    type,
    startIndex,
    endIndex,
    isError: flags.isError ?? false,
    isMissing: flags.isMissing ?? false,
  } as unknown as TestNode
}

function nestedNode(depth: number): TestNode {
  let current = node('ERROR', depth, depth + 1, { isError: true })
  for (let index = depth - 1; index >= 0; index -= 1) {
    current = {
      ...node('node', index, depth + 1),
      children: [current],
    } as unknown as TestNode
  }

  return current
}

function fakeTree(root: TestNode, hasError = true): Tree {
  Object.defineProperty(root, 'hasError', { value: hasError, configurable: true })
  return {
    rootNode: root,
    walk: () => new FakeTreeCursor(root),
  } as unknown as Tree
}

function highlightedRuntime(query: Query): Parameters<typeof collectCaptures>[1] {
  return {
    descriptor: {
      id: 'typescript',
      extensions: [],
      aliases: [],
      wasmUrl: 'test.wasm',
      highlightQuerySource: '(identifier) @variable',
    },
    language: {},
    parser: {},
    highlightQuery: query,
    foldQuery: null,
    injectionQuery: null,
  } as unknown as Parameters<typeof collectCaptures>[1]
}

function cancellationContext(): Parameters<typeof collectCaptures>[2] {
  return {
    startedAt: globalThis.performance?.now() ?? Date.now(),
    budgetMs: 1_000,
    flag: null,
  }
}

function treeSitterRange(startIndex: number, endIndex: number): TreeSitterRange {
  return {
    endIndex,
    endPosition: { column: endIndex, row: 0 },
    startIndex,
    startPosition: { column: startIndex, row: 0 },
  }
}

class FakeTreeCursor {
  private readonly path: { node: TestNode; siblings: readonly TestNode[]; index: number }[]

  public constructor(root: TestNode) {
    this.path = [{ node: root, siblings: [root], index: 0 }]
  }

  public get nodeType(): string {
    return this.current.node.type
  }

  public get nodeIsMissing(): boolean {
    return this.current.node.isMissing
  }

  public get startIndex(): number {
    return this.current.node.startIndex
  }

  public get endIndex(): number {
    return this.current.node.endIndex
  }

  public gotoFirstChild(): boolean {
    const children = this.current.node.children
    if (children.length === 0) return false

    this.path.push({ node: children[0]!, siblings: children, index: 0 })
    return true
  }

  public gotoNextSibling(): boolean {
    const current = this.current
    const index = current.index + 1
    const node = current.siblings[index]
    if (!node) return false

    this.path[this.path.length - 1] = { node, siblings: current.siblings, index }
    return true
  }

  public gotoParent(): boolean {
    if (this.path.length <= 1) return false

    this.path.pop()
    return true
  }

  public delete(): void {
    this.path.length = 0
  }

  private get current(): { node: TestNode; siblings: readonly TestNode[]; index: number } {
    const current = this.path[this.path.length - 1]
    if (!current) throw new Error('Cursor is disposed')
    return current
  }
}

describe('parse document reuse', () => {
  type WorkerParsedDocument = Parameters<typeof replaceCachedDocument>[1]
  type WorkerParseRequest = Parameters<typeof reusableParsedDocument>[0]

  const fakeParsedDocument = (
    length: number,
    deleted: string[],
    readOnly = false,
  ): WorkerParsedDocument => ({
    readOnly,
    snapshotVersion: 1,
    languageId: 'typescript',
    source: inputFromText('x'.repeat(length)),
    layers: [
      {
        id: 'root',
        key: 'root',
        kind: 'root',
        parentId: null,
        parentLanguageId: null,
        languageId: 'typescript',
        depth: 0,
        ranges: [],
        tree: { delete: () => deleted.push('root') } as unknown as Tree,
      },
    ],
    degraded: [],
    missingLanguages: [],
    size: length,
    lastUsed: 0,
  })

  const parseRequest = (
    runtimeSessionId: string,
    snapshotVersion: number,
    readOnly?: boolean,
  ): WorkerParseRequest => ({
    type: 'parse',
    documentId: 'doc',
    runtimeSessionId,
    languageId: 'typescript',
    snapshotVersion,
    readOnly,
    includeHighlights: false,
    generation: 1,
    source: messageSource,
  })

  const sourceOfLength = (length: number) => inputFromText('x'.repeat(length))

  it.each([
    { cachedReadOnly: false, requestedReadOnly: undefined },
    { cachedReadOnly: false, requestedReadOnly: false },
    { cachedReadOnly: false, requestedReadOnly: true },
    { cachedReadOnly: true, requestedReadOnly: true },
  ])('reuses an identical version with compatible intent: %j', async (intent) => {
    const runtimeSessionId = 'runtime-reuse'
    const deleted: string[] = []
    const document = fakeParsedDocument(10, deleted, intent.cachedReadOnly)
    replaceCachedDocument(runtimeSessionId, document)

    expect(
      await reusableParsedDocument(
        parseRequest(runtimeSessionId, 1, intent.requestedReadOnly),
        sourceOfLength(10),
        {
          startedAt: 0,
          budgetMs: Infinity,
          flag: null,
        },
      ),
    ).toBe(document)
    expect(document.readOnly).toBe(intent.cachedReadOnly)
    expect(deleted).toEqual([])
    disposeDocument(runtimeSessionId)
  })

  it.each([undefined, false])(
    'retires an immutable snapshot before mutable promotion: readOnly=%s',
    async (readOnly) => {
      const runtimeSessionId = 'runtime-promotion'
      const deleted: string[] = []
      replaceCachedDocument(runtimeSessionId, fakeParsedDocument(10, deleted, true))

      expect(
        await reusableParsedDocument(
          parseRequest(runtimeSessionId, 1, readOnly),
          sourceOfLength(10),
          {
            startedAt: 0,
            budgetMs: Infinity,
            flag: null,
          },
        ),
      ).toBeNull()
      expect(deleted).toEqual(['root'])
      disposeDocument(runtimeSessionId)
      expect(deleted).toEqual(['root'])
    },
  )

  it('drops the same-version snapshot before reparsing when content length differs', async () => {
    const runtimeSessionId = 'runtime-length-mismatch'
    const deleted: string[] = []
    replaceCachedDocument(runtimeSessionId, fakeParsedDocument(10, deleted))

    expect(
      await reusableParsedDocument(parseRequest(runtimeSessionId, 1), sourceOfLength(12), {
        startedAt: 0,
        budgetMs: Infinity,
        flag: null,
      }),
    ).toBeNull()
    expect(deleted).toEqual(['root'])
    expect(
      await reusableParsedDocument(parseRequest(runtimeSessionId, 1), sourceOfLength(12), {
        startedAt: 0,
        budgetMs: Infinity,
        flag: null,
      }),
    ).toBeNull()
    expect(deleted).toEqual(['root'])
    disposeDocument(runtimeSessionId)
  })

  it('does not reuse across snapshot versions', async () => {
    const runtimeSessionId = 'runtime-version-mismatch'
    const deleted: string[] = []
    const document = fakeParsedDocument(10, deleted)
    replaceCachedDocument(runtimeSessionId, document)

    expect(
      await reusableParsedDocument(parseRequest(runtimeSessionId, 2), sourceOfLength(10), {
        startedAt: 0,
        budgetMs: Infinity,
        flag: null,
      }),
    ).toBeNull()
    expect(deleted).toEqual([])
    disposeDocument(runtimeSessionId)
  })
})
