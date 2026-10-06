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

  it('walks deeply nested trees without recursive stack overflow', () => {
    const root = nestedNode(12_000)

    expect(collectTreeData(fakeTree(root)).errors).toHaveLength(1)
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

  it('skips highlights when tree-sitter provides null trees or capture nodes', () => {
    const query = {
      matches: () => [{ captures: [{ name: 'variable', node: null }] }],
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

function fakeTree(root: TestNode): Tree {
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

  const fakeParsedDocument = (length: number, deleted: string[]): WorkerParsedDocument =>
    ({
      snapshotVersion: 1,
      languageId: 'typescript',
      source: inputFromText('x'.repeat(length)),
      layers: [{ tree: { delete: () => deleted.push('root') } }],
      degraded: [],
      missingLanguages: [],
      size: length,
      lastUsed: 0,
    }) as unknown as WorkerParsedDocument

  const parseRequest = (runtimeSessionId: string, snapshotVersion: number): WorkerParseRequest =>
    ({
      documentId: 'doc',
      runtimeSessionId,
      languageId: 'typescript',
      snapshotVersion,
    }) as unknown as WorkerParseRequest

  const sourceOfLength = (length: number) => inputFromText('x'.repeat(length))

  it('reuses the cached document for an identical document version', async () => {
    const runtimeSessionId = 'runtime-reuse'
    const deleted: string[] = []
    const document = fakeParsedDocument(10, deleted)
    replaceCachedDocument(runtimeSessionId, document)

    expect(
      await reusableParsedDocument(parseRequest(runtimeSessionId, 1), sourceOfLength(10), {
        startedAt: 0,
        budgetMs: Infinity,
        flag: null,
      }),
    ).toBe(document)
    expect(deleted).toEqual([])
    disposeDocument(runtimeSessionId)
  })

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
