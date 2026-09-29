import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor'
import type { EditorPlugin, EditorViewContributionContext } from '../src/plugins'
import { createSemanticTokenLayer, type SemanticTokenLayer } from '../src/semanticTokenLayer'
import type { SemanticTokenSpan } from '../src/syntax'
import { resetEditorInstanceCount } from '../src/public/testing'

/**
 * Holding painted spans across the window between a request and its answer.
 *
 * Two mechanisms, answering two different questions. `trackRanges` answers "where is this span
 * now" — it is a property of the buffer, so a batch edit, a multi-cursor run, a formatter response
 * and a Replace All all resolve correctly, which single-edit offset projection cannot do.
 * `editsSinceTextVersion` answers "is this payload still usable at all".
 *
 * The staleness scheme is the LSP controllers' — compare the stamp, the document identity, and
 * disposal — and not the syntax controller's three-version comparison. This layer lives on the LSP
 * side of the house.
 */
const TEXT = ['const value = 1', 'const other = 2', 'const third = 3'].join('\n')
const LINE_LENGTH = 'const value = 1'.length + 1

type Harness = {
  readonly layer: SemanticTokenLayer
  readonly groups: Map<string, readonly { readonly start: number; readonly end: number }[]>
  readonly resyncs: string[]
  /** Everything painted, flattened and sorted, which is what the reader actually sees. */
  paintedRanges(): readonly { readonly start: number; readonly end: number }[]
  documentId(): string
  textVersion(): number
  type(at: number, text: string): void
  edit(edits: readonly { from: number; to: number; text: string }[]): void
  dispose(): void
}

function harness(): Harness {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const groups = new Map<string, readonly { start: number; end: number }[]>()
  const resyncs: string[] = []
  // Held on an object: both are assigned inside a callback, and a bare local would be narrowed to
  // `null` for the rest of this function whatever the callback did.
  const created: {
    layer: SemanticTokenLayer | null
    context: EditorViewContributionContext | null
  } = { layer: null, context: null }

  // Registered as a real plugin so the contribution is created, updated and disposed by the editor
  // itself: the anchors under test are the document's, and a hand-driven context would only be
  // checking arithmetic the test wrote.
  const plugin: EditorPlugin = {
    name: 'test.semantic-tokens',
    activate: (pluginContext) => [
      pluginContext.registerViewContribution({
        createContribution: (contributionContext) => {
          created.context = contributionContext
          const layer = createSemanticTokenLayer(paintingContext(contributionContext, groups), {
            name: 'semantic',
            onResyncRequired: (reason) => resyncs.push(reason),
          })
          created.layer = layer
          return layer
        },
      }),
    ],
  }

  const editor = new Editor(container, { plugins: [plugin] })
  editor.openDocument({ documentId: 'src/index.ts', text: TEXT })

  const layer = created.layer
  const viewContext = created.context
  if (!layer || !viewContext) throw new Error('the contribution never ran')

  return {
    layer,
    groups,
    resyncs,
    paintedRanges: () =>
      [...groups.values()]
        .flat()
        .toSorted((left, right) => left.start - right.start || left.end - right.end),
    documentId: () => viewContext.getSnapshot().documentId as string,
    textVersion: () => viewContext.getSnapshot().textVersion,
    type: (at, text) => editor.edit({ from: at, to: at, text }),
    edit: (edits) => editor.edit(edits),
    dispose: () => {
      editor.dispose()
      container.remove()
    },
  }
}

/**
 * Wraps the real contribution context so painted ranges land in a map the test can read, while
 * `trackRanges` and `getSnapshot` stay the editor's own — which is the point.
 */
function paintingContext(
  context: EditorViewContributionContext,
  groups: Map<string, readonly { start: number; end: number }[]>,
): EditorViewContributionContext {
  return {
    ...context,
    getSnapshot: () => context.getSnapshot(),
    trackRanges: (ranges, bias) => context.trackRanges(ranges, bias),
    setRangeHighlight: (name, ranges) => {
      groups.set(
        name,
        ranges.map((range) => ({ end: range.end, start: range.start })),
      )
    },
    clearRangeHighlight: (name) => {
      groups.delete(name)
    },
  }
}

const span = (start: number, end: number, tokenType = 'variable'): SemanticTokenSpan => ({
  end,
  start,
  tokenType,
})

describe('holding painted spans across edits', () => {
  let test: Harness

  beforeEach(() => {
    resetEditorInstanceCount()
    test = harness()
  })

  afterEach(() => {
    test.dispose()
  })

  function pushAtCurrentVersion(spans: readonly SemanticTokenSpan[]): void {
    const result = test.layer.push({
      documentId: test.documentId(),
      textVersion: test.textVersion(),
      spans,
    })
    expect(result.status).toBe('painted')
  }

  it('shifts a painted span by an insertion before it, with no request having completed', () => {
    pushAtCurrentVersion([span(6, 11)])
    test.type(0, 'x')

    expect(test.paintedRanges()).toEqual([{ start: 7, end: 12 }])
  })

  /**
   * The assertion that pins the bias pair. A character typed immediately after a span changes what
   * the identifier *is*, and the server has not been asked yet — so the span is held to what was
   * actually described rather than growing to swallow it. `{startBias: 'right', endBias: 'left'}`.
   */
  it('leaves a character typed immediately after a span outside it', () => {
    pushAtCurrentVersion([span(6, 11)])
    test.type(11, 's')

    expect(test.paintedRanges()).toEqual([{ start: 6, end: 11 }])
  })

  it('leaves a character typed immediately before a span outside it too', () => {
    pushAtCurrentVersion([span(6, 11)])
    test.type(6, '_')

    expect(test.paintedRanges()).toEqual([{ start: 7, end: 12 }])
  })

  it('shifts every span after each site of a multi-site edit', () => {
    pushAtCurrentVersion([
      span(6, 11),
      span(LINE_LENGTH + 6, LINE_LENGTH + 11),
      span(LINE_LENGTH * 2 + 6, LINE_LENGTH * 2 + 11),
    ])
    test.edit([
      { from: 0, to: 0, text: 'ab' },
      { from: LINE_LENGTH, to: LINE_LENGTH, text: 'ab' },
    ])

    expect(test.paintedRanges()).toEqual([
      { start: 8, end: 13 },
      { start: LINE_LENGTH + 10, end: LINE_LENGTH + 15 },
      { start: LINE_LENGTH * 2 + 10, end: LINE_LENGTH * 2 + 15 },
    ])
  })

  it('stops painting a span whose text was deleted outright', () => {
    pushAtCurrentVersion([span(6, 11), span(LINE_LENGTH + 6, LINE_LENGTH + 11)])
    test.edit([{ from: 6, to: 11, text: '' }])

    expect(test.paintedRanges()).toEqual([{ start: LINE_LENGTH + 1, end: LINE_LENGTH + 6 }])
  })

  /**
   * Under continuous typing the colour must never disappear wholesale and reappear — which is what a
   * layer that answered every stale payload by clearing itself would produce.
   */
  it('keeps something painted at every step of a run with no response in between', () => {
    pushAtCurrentVersion([span(6, 11), span(LINE_LENGTH + 6, LINE_LENGTH + 11)])

    for (let keystroke = 0; keystroke < 10; keystroke += 1) {
      test.type(0, 'x')
      expect(test.paintedRanges().length, `keystroke ${keystroke}`).toBeGreaterThan(0)
    }
  })
})

describe('the four-branch version table', () => {
  let test: Harness

  beforeEach(() => {
    resetEditorInstanceCount()
    test = harness()
  })

  afterEach(() => {
    test.dispose()
  })

  /**
   * Five edits at five separate sites, entered back to front so none of them moves the offsets of
   * the ones still to come. `projectedThroughEdits` counts what the chain hands back — which is the
   * *composed* edit list, so five keystrokes at one caret arrive as one edit rather than five. That
   * is the honest number, because it is what the projection actually walked.
   */
  it('projects a payload stamped a few edits ago, and says how many', () => {
    const stamped = test.textVersion()
    for (const at of [40, 32, 24, 18, 12]) test.type(at, 'x')

    const result = test.layer.push({
      documentId: test.documentId(),
      textVersion: stamped,
      spans: [span(6, 11), span(LINE_LENGTH + 6, LINE_LENGTH + 11)],
    })

    expect(result.status).toBe('painted')
    expect(result.status === 'painted' && result.projectedThroughEdits).toBe(5)
    // The first span sits before every edit site and does not move. The second starts at 22 and
    // ends at 27, so two insertions (12, 18) land before its start and three (12, 18, 24) before
    // its end — which is what makes a projected span shorter or longer rather than merely shifted.
    expect(test.paintedRanges()).toEqual([
      { start: 6, end: 11 },
      { start: 24, end: 30 },
    ])
  })

  /**
   * `DocumentEditChain` keeps a bounded number of transitions, so a slow cold server plus fast
   * typing reaches the end of it. This branch is the reason a host has to implement resync.
   */
  it('drops a payload the edit chain can no longer reach, firing resync exactly once', () => {
    const stamped = test.textVersion()
    for (let edit = 0; edit < 200; edit += 1) test.type(0, 'x')

    const result = test.layer.push({
      documentId: test.documentId(),
      textVersion: stamped,
      spans: [span(6, 11)],
    })

    expect(result).toEqual({ reason: 'version-too-old', status: 'dropped' })
    expect(test.resyncs).toEqual(['version-too-old'])
  })

  it('keeps what is already painted when a payload is dropped', () => {
    test.layer.push({
      documentId: test.documentId(),
      textVersion: test.textVersion(),
      spans: [span(6, 11)],
    })
    const before = test.paintedRanges()

    test.layer.push({
      documentId: 'src/somewhere-else.ts',
      textVersion: test.textVersion(),
      spans: [span(0, 3)],
    })

    expect(test.paintedRanges()).toEqual(before)
  })
})
