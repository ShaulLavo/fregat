import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor'
import { resetEditorInstanceCount } from '../src/public/testing'
import type {
  EditorPlugin,
  EditorTrackedPoint,
  EditorTrackedRanges,
  EditorViewContributionContext,
} from '../src/public/extensions'

type TrackRanges = NonNullable<EditorViewContributionContext['trackRanges']>
type TrackPoint = NonNullable<EditorViewContributionContext['trackPoint']>

/**
 * A contribution only ever reaches the tracking through the context it is handed, so the test takes
 * the same door: what a plugin outside this package can hold is exactly what is under test.
 */
function trackingPlugin(captured: {
  track: TrackRanges | null
  trackPoint: TrackPoint | null
}): EditorPlugin {
  return {
    name: 'test.range-tracking',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (viewContext) => {
          captured.track = viewContext.trackRanges ?? null
          captured.trackPoint = viewContext.trackPoint ?? null
          return { dispose: () => undefined, update: () => undefined }
        },
      }),
  }
}

describe('tracked document ranges', () => {
  let container: HTMLElement
  let editor: Editor
  const captured: { track: TrackRanges | null; trackPoint: TrackPoint | null } = {
    track: null,
    trackPoint: null,
  }

  beforeEach(() => {
    captured.track = null
    captured.trackPoint = null
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, {
      defaultText: 'alpha world gamma',
      plugins: [trackingPlugin(captured)],
    })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
  })

  it('answers from where the tracked text went, edit after edit', () => {
    const tracked = captured.track!([{ start: 6, end: 11 }])
    const resolved = () => tracked.resolve().map((range) => [range.start, range.end])

    expect(resolved()).toEqual([[6, 11]])

    // Before it: the span slides by what was inserted ahead of it.
    editor.edit({ from: 0, to: 0, text: '>> ' })
    expect(resolved()).toEqual([[9, 14]])

    // Inside it: it grows around the text that landed within.
    editor.edit({ from: 11, to: 11, text: 'XY' })
    expect(resolved()).toEqual([[9, 16]])

    // Across its start: what is left of it starts where the deletion cut.
    editor.edit({ from: 7, to: 10, text: '' })
    expect(resolved()).toEqual([[7, 13]])
    expect(editor.materializeFullText().slice(7, 13)).toBe('oXYrld')

    // After it: nothing moves.
    const end = editor.materializeFullText().length
    editor.edit({ from: end, to: end, text: '!' })
    expect(resolved()).toEqual([[7, 13]])
  })

  it('drops a span whose text was deleted out from under it', () => {
    const tracked = captured.track!([{ start: 6, end: 11 }])

    editor.edit({ from: 5, to: 12, text: '' })

    expect(tracked.resolve()).toEqual([])
  })

  it('absorbs text typed at the edges of a region but not at the edges of a find', () => {
    const region = captured.track!([{ start: 6, end: 11 }])
    const found = captured.track!([{ start: 6, end: 11 }], { startBias: 'right', endBias: 'left' })
    const text = (tracked: EditorTrackedRanges) =>
      tracked.resolve().map((range) => editor.materializeFullText().slice(range.start, range.end))

    // Both edits land on an edge and nowhere else: 6 is where the spans start, 13 where they end
    // once the first insertion has pushed that boundary along.
    editor.edit({ from: 6, to: 6, text: 'AB' })
    editor.edit({ from: 13, to: 13, text: 'CD' })

    expect(editor.materializeFullText()).toBe('alpha ABworldCD gamma')
    expect(region.resolve()).toEqual([{ start: 6, end: 15 }])
    expect(text(region)).toEqual(['ABworldCD'])
    expect(found.resolve()).toEqual([{ start: 8, end: 13 }])
    expect(text(found)).toEqual(['world'])
  })

  it('tracks a biased point until its source position is deleted', () => {
    const left = captured.trackPoint!({ kind: 'point', offset: 6, bias: 'left' })
    const right = captured.trackPoint!({ kind: 'point', offset: 6, bias: 'right' })

    editor.edit({ from: 6, to: 6, text: 'AB' })

    expect(left.resolve()).toEqual({ kind: 'live', offset: 6 })
    expect(right.resolve()).toEqual({ kind: 'live', offset: 8 })

    editor.edit({ from: 5, to: 9, text: '' })

    expect(left.resolve()).toEqual({ kind: 'deleted' })
    expect(right.resolve()).toEqual({ kind: 'deleted' })
  })

  it('returns null when a point is tracked without an active document', () => {
    const emptyContainer = document.createElement('div')
    const emptyCapture: { track: TrackRanges | null; trackPoint: TrackPoint | null } = {
      track: null,
      trackPoint: null,
    }
    document.body.appendChild(emptyContainer)
    const emptyEditor = new Editor(emptyContainer, { plugins: [trackingPlugin(emptyCapture)] })

    try {
      const point: EditorTrackedPoint = emptyCapture.trackPoint!({
        kind: 'point',
        offset: 0,
        bias: 'right',
      })
      expect(point.resolve()).toBeNull()
    } finally {
      emptyEditor.dispose()
      emptyContainer.remove()
    }
  })
})
