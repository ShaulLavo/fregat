import type { EditorVisibleRowSnapshot } from '@singapore-editor/core/extensions'

export function documentRow(
  bufferRow: number,
  top: number,
  overrides: Partial<EditorVisibleRowSnapshot> = {},
): EditorVisibleRowSnapshot {
  return {
    index: top / 20,
    bufferRow,
    source: 'document',
    startOffset: 0,
    endOffset: 1,
    text: 'x',
    kind: 'text',
    primaryText: true,
    firstWrapSegment: true,
    top,
    height: 20,
    leftSpacerWidth: 0,
    contentCursorLine: false,
    gutterNumberCursorLine: false,
    gutterCursorLineBackgroundLaneIds: [],
    mountedPaintSupport: 'replayable',
    chunks: [],
    foldMarker: null,
    ...overrides,
  }
}
