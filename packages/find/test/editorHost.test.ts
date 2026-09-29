import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
import type {
  EditorPlugin,
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import {
  createTestCapabilityContributionContext,
  setHighlightRegistry,
  VirtualizedTextView,
} from '@singapore-editor/core/testing'
import {
  createEditorFindContributionProviders,
  createEditorFindPlugin,
  type EditorFindFeature,
} from '../src'

/**
 * Find over the editor it ships with, rather than over a stand-in for it.
 *
 * Every snapshot the editor hands out carries a text snapshot, a line-start view
 * and range tracking, so a case built on a snapshot missing any of them exercises
 * the side of that seam no reader ever reaches — and the side a reader does reach
 * is what this milestone is about.
 */

// Long enough that the view mounts a fraction of it, which is what bounds the
// ranges the document is asked to carry.
const MATCH_LINES = 400
const LONG_TEXT = 'foo line\n'.repeat(MATCH_LINES)

class MockHighlight extends Set<Range> {
  public priority = 0
}

const paintedHighlights = new Map<string, Set<Range>>()
const openProbes: (() => void)[] = []

beforeAll(() => {
  // @ts-expect-error happy-dom carries no Highlight constructor.
  globalThis.Highlight = MockHighlight
  setHighlightRegistry({
    delete: (name: string) => paintedHighlights.delete(name),
    set: (name: string, highlight: unknown) =>
      void paintedHighlights.set(name, highlight as Set<Range>),
  })
})

afterAll(() => {
  setHighlightRegistry(undefined)
})

afterEach(() => {
  for (const dispose of openProbes.toReversed()) dispose()
  openProbes.length = 0
  paintedHighlights.clear()
  document.body.replaceChildren()
})

describe('find inside a real editor', () => {
  it('keeps its marks on the text they were found in while a re-search is outstanding', () => {
    const probe = editorProbe('zz foo zz\nsecond foo line\n', [
      createEditorFindPlugin({ seedSearchStringFromSelection: 'never' }),
    ])
    probe.editor.openFind()
    typeSearch(probe.context.container, 'foo')
    expect(paintedText()).toEqual({ match: ['foo', 'foo'], current: ['foo'] })

    probe.editor.edit({ from: 0, to: 0, text: 'XY' })

    // The re-search is deferred, so until it lands these marks are the whole of
    // what the reader sees — and each is still on the word it was found in
    // rather than two characters to the left of it, the selected one included.
    expect(paintedText()).toEqual({ match: ['foo', 'foo'], current: ['foo'] })
  })

  it('keeps its marks on their text after the reader scrolls to other matches', () => {
    const probe = editorProbe(LONG_TEXT, [
      createEditorFindPlugin({ seedSearchStringFromSelection: 'never' }),
    ])
    probe.editor.openFind()
    typeSearch(probe.context.container, 'foo')
    scrollTo(probe.context, 1_500)

    // Typed above every row now on screen, so nothing the reader is looking at
    // stays at the offset it was found at.
    probe.editor.edit({ from: 0, to: 0, text: 'X' })

    const onScreen = mountedMatchCount(probe.context.getSnapshot())
    expect(onScreen).toBeGreaterThan(0)
    expect(paintedText().match).toEqual(Array.from({ length: onScreen }, () => 'foo'))
  })

  // The mirror of the case above, and the one that matters more: a reader types and then scrolls.
  // Nothing follows a match while it is off screen, so the offsets waiting there describe text that
  // has since moved, and the scroll is what hands one of them to the document to be followed from
  // where it used to be.
  it('keeps its marks on their text when the reader edits and then scrolls', () => {
    const probe = editorProbe(LONG_TEXT, [
      createEditorFindPlugin({ seedSearchStringFromSelection: 'never' }),
    ])
    probe.editor.openFind()
    typeSearch(probe.context.container, 'foo')

    probe.editor.edit({ from: 0, to: 0, text: 'X' })
    scrollTo(probe.context, 1_500)

    const onScreen = mountedMatchCount(probe.context.getSnapshot())
    expect(onScreen).toBeGreaterThan(0)
    expect(paintedText().match).toEqual(Array.from({ length: onScreen }, () => 'foo'))
  })

  it('steps to a match the reader scrolled to while a re-search is outstanding', () => {
    const probe = editorProbe(LONG_TEXT, [
      createEditorFindPlugin({ seedSearchStringFromSelection: 'never' }),
    ])
    probe.editor.openFind()
    typeSearch(probe.context.container, 'foo')
    scrollTo(probe.context, 1_500)
    probe.editor.setSelection(455, 455)

    probe.editor.edit({ from: 0, to: 0, text: 'X' })
    probe.editor.findNext()

    expect(selectedText(probe)).toBe('foo')
  })

  it('leaves a mark on the word it found when the reader types against its edge', () => {
    const probe = editorProbe('zz foo zz\n', [
      createEditorFindPlugin({ seedSearchStringFromSelection: 'never' }),
    ])
    probe.editor.openFind()
    typeSearch(probe.context.container, 'foo')

    // Typing at either edge of a match adds text the query never answered for,
    // so the mark must not take it in while the re-search is outstanding.
    probe.editor.edit({ from: 6, to: 6, text: 'X' })

    expect(paintedText().match).toEqual(['foo'])
  })

  it('keeps a scope on the text the reader marked', () => {
    const probe = editorProbe('head\nfoo mid\ntail\n', [
      createEditorFindPlugin({ seedSearchStringFromSelection: 'never' }),
    ])
    probe.editor.setSelection(5, 12)
    probe.editor.openFind()
    clickScope(probe.context.container)
    typeSearch(probe.context.container, 'foo')
    expect(paintedText()).toEqual({ match: ['foo'], current: ['foo'], scope: ['foo mid'] })

    probe.editor.edit({ from: 0, to: 0, text: 'XY' })

    // A scope decides where Replace All is allowed to rewrite, so it is followed
    // wherever its text goes and however far off screen it ends up.
    expect(paintedText()).toEqual({ match: ['foo'], current: ['foo'], scope: ['foo mid'] })
  })

  // The caret jumping back up the file is the only sign the search ran out and started again, and a
  // reader who is not watching the caret has nothing else to go on.
  it('says so when Find Next runs out of document and starts again', () => {
    const probe = editorProbe('foo one\nfoo two\n', [
      createEditorFindPlugin({ seedSearchStringFromSelection: 'never' }),
    ])
    probe.editor.openFind()
    typeSearch(probe.context.container, 'foo')

    // Opening lands on the first match, so one press reaches the last one and the next wraps.
    probe.editor.findNext()

    expect(announcements(probe.context.container)).toEqual([])

    probe.editor.findNext()

    expect(announcements(probe.context.container)).toEqual(['Wrapped to the first match'])
  })

  it('never asks the editor to materialize what it already holds', () => {
    const probe = editorProbe(LONG_TEXT)
    const materialized = { fullText: 0, lineStarts: 0 }
    const snapshot = countedSnapshot(probe.context.getSnapshot(), materialized)
    const find = attachFind({ ...probe.context, getSnapshot: () => snapshot })

    find.typeSearch('foo')

    expect({ count: find.count(), ...materialized }).toEqual({
      count: `1 of ${MATCH_LINES}`,
      fullText: 0,
      lineStarts: 0,
    })
  })

  it('has the document carry only the matches on screen through a keystroke', () => {
    const probe = editorProbe(LONG_TEXT)
    const carried: number[] = []
    let resolved = 0
    const find = attachFind({
      ...probe.context,
      trackRanges: (ranges) => {
        carried.push(ranges.length)
        const tracked = probe.context.trackRanges!(ranges)
        return {
          resolve: () => {
            resolved += ranges.length
            return tracked.resolve()
          },
        }
      },
    })

    find.typeSearch('foo')
    const onScreen = mountedMatchCount(probe.context.getSnapshot())

    // A view holding every match would leave the bound unobservable.
    expect(onScreen).toBeLessThan(MATCH_LINES)
    expect(carried).toEqual([onScreen, onScreen, onScreen])

    // Typed on the second line, so the matches behind it move and the one the
    // caret sits on does not.
    probe.editor.edit({ from: 12, to: 12, text: 'X' })
    find.changed()

    // What the keystroke costs is one anchor pair per match the reader can see,
    // and the matches nobody can see are still counted and still painted.
    expect({ resolved, count: find.count() }).toEqual({
      resolved: onScreen,
      count: `1 of ${MATCH_LINES}`,
    })
  })
})

type EditorProbe = {
  readonly editor: Editor
  readonly context: EditorViewContributionContext
}

type FindAttachment = {
  typeSearch(value: string): void
  count(): string
  /** The content update the editor sends its contributions once an edit has landed. */
  changed(): void
}

type Materializations = { fullText: number; lineStarts: number }

// The context the editor builds for its own contributions, which is the one find
// runs on in front of a reader; a case takes it and replaces the single member it
// is about.
function editorProbe(text: string, plugins: readonly EditorPlugin[] = []): EditorProbe {
  const container = document.createElement('div')
  document.body.append(container)
  const contexts: EditorViewContributionContext[] = []
  const capture: EditorPlugin = {
    name: 'find.test.capture',
    activate: (context) => [
      context.registerViewContribution({
        createContribution: (viewContext) => {
          contexts.push(viewContext)
          return { update: () => {}, dispose: () => {} }
        },
      }),
    ],
  }

  const editor = new Editor(container, { defaultText: text, plugins: [...plugins, capture] })
  const view: unknown = Reflect.get(editor, 'view')
  // happy-dom has no layout, so deliver the first visible viewport measurement explicitly.
  if (view instanceof VirtualizedTextView) view.setScrollMetrics(0, 24)
  openProbes.push(() => {
    editor.dispose()
    container.remove()
  })

  const context = contexts[0]
  if (!context) throw new Error('the editor built no view contribution')

  return { editor, context }
}

function attachFind(context: EditorViewContributionContext): FindAttachment {
  const providers = createEditorFindContributionProviders({
    seedSearchStringFromSelection: 'never',
  })
  const view = providers.view.createContribution(context)
  const features: EditorFindFeature[] = []
  const capability = providers.capability.createContribution(
    createTestCapabilityContributionContext({
      registerFeature: (_token, feature) => {
        features.push(feature as EditorFindFeature)
        return { dispose: () => {} }
      },
    }),
  )
  openProbes.push(() => {
    capability?.dispose()
    view?.dispose()
  })
  features[0]?.openFind()

  return {
    typeSearch: (value) => typeSearch(context.container, value),
    count: () => context.container.querySelector('.editor-find-count')?.textContent ?? '',
    changed: () => void view?.update(context.getSnapshot(), 'content', null),
  }
}

// What the reader sees under each group, read back off the registry the renderer
// publishes to: a mark that slid onto neighbouring characters says so here.
function paintedText(): Record<string, readonly string[]> {
  const painted: Record<string, readonly string[]> = {}
  for (const [name, highlight] of paintedHighlights) {
    const group = name.split('-find-')[1]
    if (group) painted[group] = Array.from(highlight, (range) => range.toString())
  }
  return painted
}

// Counted rather than made to throw, so a case that does reach a materializer
// reports how often instead of only that it happened.
function countedSnapshot(
  snapshot: EditorViewSnapshot,
  materialized: Materializations,
): EditorViewSnapshot {
  // The runtime source can still materialize; a read type only hides it, so count the call.
  const textSnapshot = new Proxy(snapshot.textSnapshot, {
    get: (target, property) => {
      if (property === 'materializeFullText') materialized.fullText += 1
      const value: unknown = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return new Proxy(snapshot, {
    get: (target, property) => {
      if (property === 'textSnapshot') return textSnapshot
      if (property === 'lineStarts') materialized.lineStarts += 1
      return Reflect.get(target, property)
    },
  })
}

// What a screen reader would have been told, read off the live regions the editor publishes into.
function announcements(container: HTMLElement): string[] {
  const host = container.closest('div')?.parentElement ?? document.body
  return [...host.querySelectorAll('[role="status"]')]
    .map((region) => region.textContent ?? '')
    .filter((text) => text.length > 0)
}

function mountedMatchCount(snapshot: EditorViewSnapshot): number {
  return snapshot.visibleRows.filter((row) => row.text.slice(0, row.text.length).includes('foo'))
    .length
}

// Scrolled the way a reader does, so the rows the view mounts are recomputed and
// the contributions hear about it from the editor rather than from the case.
function scrollTo(context: EditorViewContributionContext, top: number): void {
  context.scrollElement.scrollTop = top
  context.scrollElement.dispatchEvent(new Event('scroll'))
}

function selectedText(probe: EditorProbe): string {
  const selection = probe.context.getSnapshot().selections[0]
  if (!selection) return ''

  return probe.editor.materializeFullText().slice(selection.startOffset, selection.endOffset)
}

// Addressed by the icon it renders, which outlives the label a toggle rewrites
// every time it is pressed.
function clickScope(container: HTMLElement): void {
  for (const button of container.querySelectorAll<HTMLButtonElement>('.editor-find-button')) {
    if (button.querySelector('[data-icon="selection"]')) {
      button.click()
      return
    }
  }

  throw new Error('missing find scope toggle')
}

function typeSearch(container: HTMLElement, value: string): void {
  const input = container.querySelector<HTMLInputElement>(
    '.editor-find-input:not(.editor-find-input-standalone)',
  )
  if (!input) throw new Error('missing find input')

  // One event per character, because each is a search of its own.
  for (const character of value) {
    input.value += character
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
}
