import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { EditorSyntaxCapture } from '../src/syntax'
import { styleForTreeSitterCapture, treeSitterCapturesToEditorTokens } from '../src/syntax'
import { type VirtualizedTextHighlightRegistry, VirtualizedTextView } from '../src/virtualization'

/**
 * The paint-order half of exact-span capture resolution.
 *
 * The token-level assertions live beside the real grammars, in @singapore-editor/tree-sitter-languages. What
 * only a mounted view can show is the consequence: that a span four rules claim reaches one
 * highlight group rather than four, and that which colour wins no longer depends on what this
 * document's shared token registry happened to see first.
 */
class MockHighlight extends Set<Range> {
  priority = 0
}

const ROW_HEIGHT = 20
const MAX_SOURCE = 'const MAX = 10\n'
const OTHER_SOURCE = 'class Other {}\n'
const MAX_START = MAX_SOURCE.indexOf('MAX')
const MAX_END = MAX_START + 'MAX'.length

// The capture names the shipped TypeScript and JavaScript queries really do produce over `MAX`,
// pinned against the live grammars by the exact-span suite in @singapore-editor/tree-sitter-languages.
const MAX_CAPTURES: readonly EditorSyntaxCapture[] = [
  { captureName: 'keyword.declaration', endIndex: 5, startIndex: 0 },
  { captureName: 'constant', endIndex: MAX_END, startIndex: MAX_START },
  { captureName: 'constructor', endIndex: MAX_END, startIndex: MAX_START },
  { captureName: 'type', endIndex: MAX_END, startIndex: MAX_START },
  { captureName: 'variable', endIndex: MAX_END, startIndex: MAX_START },
  { captureName: 'number', endIndex: 14, startIndex: 12 },
]

// Opened first, this one puts `constructor` and `type` into the shared registry ahead of
// `constant` — which is what used to decide the colour of `MAX` in the other document.
const OTHER_CAPTURES: readonly EditorSyntaxCapture[] = [
  { captureName: 'keyword', endIndex: 5, startIndex: 0 },
  { captureName: 'constructor', endIndex: 11, startIndex: 6 },
  { captureName: 'type', endIndex: 11, startIndex: 6 },
  { captureName: 'punctuation.bracket', endIndex: 13, startIndex: 12 },
]

type OpenDocument = readonly [text: string, captures: readonly EditorSyntaxCapture[]]

const highlights = new Map<string, Highlight>()
const registry: VirtualizedTextHighlightRegistry = {
  set: (name, highlight) => {
    highlights.set(name, highlight)
  },
  delete: (name) => highlights.delete(name),
}

function rulesByName(): Map<string, string> {
  const rules = new Map<string, string>()
  for (const style of document.head.querySelectorAll('style')) {
    for (const match of (style.textContent ?? '').matchAll(/::highlight\((.+?)\)\s*\{(.*?)\}/g)) {
      rules.set(match[1] ?? '', (match[2] ?? '').trim())
    }
  }
  return rules
}

/**
 * Opens each document in turn and reports, in registry order, the rule bodies of every group that
 * painted the span of `MAX`. Every view is disposed at the end, which releases the shared token
 * groups and leaves the next call starting from an empty registry — one session per call, so the
 * only thing an ordering can carry is the order itself.
 */
function openInOrder(documents: readonly OpenDocument[]): readonly string[] {
  const views: VirtualizedTextView[] = []
  const containers: HTMLElement[] = []

  for (const [text, captures] of documents) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    containers.push(container)

    const view = new VirtualizedTextView(container, {
      highlightRegistry: registry,
      overscan: 0,
      rowHeight: ROW_HEIGHT,
    })
    view.setText(text)
    view.setScrollMetrics(0, ROW_HEIGHT * 4)
    view.setTokens(treeSitterCapturesToEditorTokens(captures))
    views.push(view)
  }

  const rules = rulesByName()
  const painted: string[] = []
  for (const [name, highlight] of highlights) {
    for (const range of highlight as unknown as Set<Range>) {
      if (range.startOffset !== MAX_START || range.endOffset !== MAX_END) continue

      painted.push(rules.get(name) ?? `<unruled ${name}>`)
      break
    }
  }

  for (const view of views) view.dispose()
  for (const container of containers) container.remove()
  return painted
}

describe('token highlights for a span several capture rules claim', () => {
  beforeEach(() => {
    highlights.clear()
    // @ts-expect-error happy-dom does not provide Highlight.
    globalThis.Highlight = MockHighlight
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'Highlight')
  })

  it('paints it through exactly one group, and that group is the constant', () => {
    expect(openInOrder([[MAX_SOURCE, MAX_CAPTURES]])).toEqual([
      `color: ${styleForTreeSitterCapture('constant')?.color};`,
    ])
  })

  it('drains the shared registry when the session ends, so each ordering starts even', () => {
    openInOrder([[MAX_SOURCE, MAX_CAPTURES]])
    expect(highlights.size).toBe(0)
  })

  /**
   * Before exact-span resolution all four styles were registered, all four sat at the default
   * priority, and paint fell through to registry insertion order — "the first time this document's
   * shared registry saw that style key". Opening the other file first put `constructor` and `type`
   * in ahead of `constant`, and the identifier changed colour for the rest of the session.
   */
  it('paints the same colour whichever document the session opened first', () => {
    const maxFirst = openInOrder([
      [MAX_SOURCE, MAX_CAPTURES],
      [OTHER_SOURCE, OTHER_CAPTURES],
    ])
    const otherFirst = openInOrder([
      [OTHER_SOURCE, OTHER_CAPTURES],
      [MAX_SOURCE, MAX_CAPTURES],
    ])

    expect(otherFirst).toEqual(maxFirst)
    expect(otherFirst).toHaveLength(1)
  })
})
