import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  createCompletionWidgetController,
  rankCompletionItems,
  type CompletionWidgetController,
} from '../src/completion'
import { fuzzyMatch, looseFuzzyMatch } from '../src/fuzzyMatch'

const WIDGET_NAMESPACE = 'test-filter'

describe('fuzzyMatch', () => {
  it('finds an initialism spelled out of a name’s humps', () => {
    expect(fuzzyMatch('cthn', 'createThreadName')?.positions).toEqual([0, 6, 7, 12])
  })

  it('scores a word start above the same letters found mid-word', () => {
    const start = fuzzyMatch('val', 'value')
    const middle = fuzzyMatch('lue', 'value')

    expect(start?.score).toBeGreaterThan(middle?.score ?? 0)
  })

  // A pattern that only turns up inside a word is a coincidence, not what the user reached for.
  it('refuses a match that starts nowhere in particular', () => {
    expect(fuzzyMatch('oob', 'foobar')).toBeNull()
    expect(looseFuzzyMatch('oob', 'foobar')?.positions).toEqual([1, 2, 3])
  })

  // Server lists carry the occasional enormous label; the table walk is capped so one of them costs
  // what any other label costs.
  it('stops looking at a candidate past its budget', () => {
    expect(fuzzyMatch('zoom', `${'x'.repeat(100)}-zoom`)?.positions).toEqual([101, 102, 103, 104])
    expect(fuzzyMatch('zoom', `${'x'.repeat(200)}-zoom`)).toBeNull()
  })
})

describe('rankCompletionItems', () => {
  it('puts the name whose humps spell the typing above the one that merely contains it', () => {
    const ranked = rankCompletionItems(
      [{ label: 'catchnothing' }, { label: 'createThreadName' }],
      'cthn',
    )

    expect(ranked.map((item) => item.label)).toEqual(['createThreadName', 'catchnothing'])
  })

  it('narrows the list it produced rather than the one the server sent', () => {
    const scored: string[] = []
    const items = ['value', 'valueOf', 'other'].map((label) => watchedItem(label, scored))

    rankCompletionItems(items, 'val')
    scored.length = 0
    const ranked = rankCompletionItems(items, 'valu')

    expect(ranked.map((item) => item.label)).toEqual(['value', 'valueOf'])
    expect(scored).toContain('value')
    expect(scored).not.toContain('other')
  })

  // A word the previous one is not a prefix of is a different question, so the previous answer is no
  // longer the search space.
  it('goes back to the server list when the word is retyped from further back', () => {
    const scored: string[] = []
    const items = ['value', 'other'].map((label) => watchedItem(label, scored))

    rankCompletionItems(items, 'val')
    scored.length = 0
    rankCompletionItems(items, 'oth')

    expect(scored).toContain('other')
  })
})

describe('the completion widget', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('marks the characters of each label the typing accounted for', () => {
    const ranked = rankCompletionItems([{ label: 'value' }, { label: 'verticalAlign' }], 'val')

    showWidget(ranked)

    expect(labelTexts()).toEqual(['value', 'verticalAlign'])
    expect(markedRuns()).toEqual(['val', 'v', 'Al'])
  })

  // The positions the filter text earned address the filter text; on the label they land a character
  // off, which is one character of nonsense in every row of the list.
  it('marks a label filtered by another string in that label’s own places', () => {
    const ranked = rankCompletionItems([{ filterText: 'include', label: '#include' }], 'inc')

    showWidget(ranked)

    expect(labelTexts()).toEqual(['#include'])
    expect(markedRuns()).toEqual(['inc'])
  })

  // A hundred rows are offered in a box a handful of them fit in, and the widget never takes the
  // focus, so nothing native follows the arrow keys down it: the highlight would walk off the edge
  // and Enter would commit a row nobody could see.
  it('scrolls the row the arrow keys reached into the box', () => {
    const controller = showWidget(
      Array.from({ length: 60 }, (_, index) => ({ label: `val${index}` })),
    )
    layOutRows(24, 120)

    // Up from the top row wraps to the end, which is as far as the box has to travel.
    controller.moveSelection(-1)
    expect(widgetElement().scrollTop).toBe(60 * 24 - 120)

    controller.moveSelection(1)
    expect(widgetElement().scrollTop).toBe(0)
  })

  it('leaves the box where it is while the focus stays inside it', () => {
    const controller = showWidget(
      Array.from({ length: 60 }, (_, index) => ({ label: `val${index}` })),
    )
    layOutRows(24, 120)

    controller.moveSelection(3)

    expect(widgetElement().scrollTop).toBe(0)
  })
})

function watchedItem(label: string, scored: string[]): lsp.CompletionItem {
  return {
    label,
    get filterText() {
      scored.push(label)
      return label
    },
  }
}

function showWidget(items: readonly lsp.CompletionItem[]): CompletionWidgetController {
  const controller = createCompletionWidgetController({
    document,
    themeSource: document.createElement('div'),
    classNamespace: WIDGET_NAMESPACE,
    onSelect: vi.fn(),
  })
  controller.show({ anchor: new DOMRect(10, 20, 1, 16), items })
  return controller
}

/** The layout the environment does not do: rows of a height, in a box that shows some of them. */
function layOutRows(rowHeightPx: number, visibleHeightPx: number): void {
  Object.defineProperty(widgetElement(), 'clientHeight', {
    configurable: true,
    value: visibleHeightPx,
  })
  const rows = document.querySelectorAll<HTMLElement>(
    `.editor-${WIDGET_NAMESPACE}-completion [role="option"]`,
  )
  for (const [index, row] of rows.entries()) {
    Object.defineProperty(row, 'offsetTop', { configurable: true, value: index * rowHeightPx })
    Object.defineProperty(row, 'offsetHeight', { configurable: true, value: rowHeightPx })
  }
}

function widgetElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>(`.editor-${WIDGET_NAMESPACE}-completion`)
  if (!element) throw new Error('missing completion widget')
  return element
}

function labelTexts(): readonly string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      `.editor-${WIDGET_NAMESPACE}-completion [role="option"]`,
    ),
    (row) => row.children[1]?.textContent ?? '',
  )
}

function markedRuns(): readonly string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`.editor-${WIDGET_NAMESPACE}-completion-match`),
    (element) => element.textContent ?? '',
  )
}
