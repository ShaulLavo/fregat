import { applyEditorTheme } from '@singapor/core'
import { cn } from '@workspace/ui/lib/utils'
import type { CSSProperties, RefObject } from 'react'
import { useLayoutEffect, useRef } from 'react'

import {
  EDITOR_VISIBLE_SNAPSHOT_FOLD_CHEVRON_PATH,
  editorVisibleSnapshotSegmentPresentation,
  editorVisibleSnapshotSegments,
} from '@/features/workbench/utils/editor-visible-snapshot'
import type { CachedEditorVisibleSnapshot } from '@/lib/editor-visible-snapshot-cache'
import { EditorVisiblePaintLayers } from '@/features/workbench/components/editor-visible-paint-layers'

type EditorVisibleSnapshotProps = {
  readonly indentationGuidesEnabled: boolean
  readonly overlayRef: RefObject<HTMLDivElement | null>
  readonly record: CachedEditorVisibleSnapshot
}

/** A bounded, inert copy of the last mounted editor paint. It never feeds the live editor. */
export function EditorVisibleSnapshot({
  indentationGuidesEnabled,
  overlayRef,
  record,
}: EditorVisibleSnapshotProps) {
  const themeRef = useRef<HTMLDivElement>(null)
  const { snapshot } = record
  const rowHeight = snapshot.metrics.rowHeight
  const characterWidth = snapshot.metrics.characterWidth
  const contentLeft = snapshot.gutterWidth - snapshot.viewport.scrollLeft
  const contentWidth = Math.max(
    snapshot.contentWidth,
    snapshot.viewport.clientWidth - snapshot.gutterWidth,
  )
  const editorStyle = {
    '--editor-gutter-width': `${snapshot.gutterWidth}px`,
    '--editor-row-height': `${rowHeight}px`,
    '--editor-tab-size': snapshot.tabSize,
  } as CSSProperties

  useLayoutEffect(() => {
    const element = themeRef.current
    if (!element) return

    applyEditorTheme(element, snapshot.theme)
  }, [snapshot.theme])

  return (
    <div
      aria-hidden='true'
      className='app-editor-host pointer-events-none absolute inset-0 z-10 overflow-hidden select-none'
      data-editor-visible-snapshot=''
      ref={overlayRef}
    >
      <div className='editor-virtualized h-full w-full' ref={themeRef} style={editorStyle}>
        <div
          className='editor-virtualized-gutter absolute inset-y-0 left-0 overflow-hidden'
          style={{ width: snapshot.gutterWidth }}
        >
          {snapshot.rows.map((row) => (
            <div
              className='editor-virtualized-gutter-row absolute left-0 flex w-full'
              data-editor-visible-gutter-row={row.index}
              key={`gutter:${row.index}`}
              style={{
                height: row.height,
                top: row.top - snapshot.viewport.scrollTop,
              }}
            >
              {snapshot.gutterLayout.fixedWidth > 0 ? (
                <span
                  aria-hidden='true'
                  className='h-full shrink-0'
                  style={{ width: snapshot.gutterLayout.fixedWidth }}
                />
              ) : null}
              {snapshot.gutterLayout.lanes.map((lane) => {
                const cursorLine = row.gutterCursorLineBackgroundLaneIds.includes(lane.id)
                const lineNumber = lane.id === 'line-gutter' && row.firstWrapSegment

                return (
                  <span
                    className={cn(
                      'editor-virtualized-gutter-cell',
                      cursorLine && 'editor-virtualized-cursor-line-gutter',
                      lineNumber && 'editor-virtualized-gutter-label',
                      lineNumber &&
                        row.gutterNumberCursorLine &&
                        'editor-virtualized-line-number-active',
                    )}
                    data-editor-visible-gutter-lane={lane.id}
                    key={lane.id}
                    style={{ width: lane.width }}
                  >
                    {lineNumber ? row.bufferRow + 1 : null}
                    {lane.id === 'fold-gutter' && row.firstWrapSegment && row.foldMarker ? (
                      <span
                        className='editor-virtualized-fold-toggle app-fold-gutter-icon'
                        data-editor-fold-state={row.foldMarker.collapsed ? 'collapsed' : 'expanded'}
                      >
                        <svg
                          className='app-fold-chevron'
                          fill='currentColor'
                          height='12'
                          viewBox='0 0 256 256'
                          width='12'
                        >
                          <path d={EDITOR_VISIBLE_SNAPSHOT_FOLD_CHEVRON_PATH} />
                        </svg>
                      </span>
                    ) : null}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
        {snapshot.rows.map((row) => (
          <div
            className={
              row.contentCursorLine
                ? 'editor-virtualized-row editor-virtualized-cursor-line-row absolute whitespace-pre'
                : 'editor-virtualized-row absolute whitespace-pre'
            }
            data-editor-visible-row={row.index}
            key={`content:${row.index}`}
            style={{
              height: row.height,
              left: contentLeft,
              lineHeight: `${row.height}px`,
              minWidth: contentWidth,
              top: row.top - snapshot.viewport.scrollTop,
            }}
          >
            {row.leftSpacerWidth > 0 ? (
              <span
                aria-hidden='true'
                className='editor-virtualized-row-spacer'
                style={{ width: row.leftSpacerWidth }}
              />
            ) : null}
            {row.chunks.map((chunk, chunkIndex) => (
              <span
                className='editor-virtualized-row-chunk'
                data-editor-visible-chunk={chunkIndex}
                data-editor-visible-fidelity={chunk.replayFidelity}
                key={chunkIndex}
              >
                {editorVisibleSnapshotSegments(chunk).map((segment, segmentIndex) => {
                  const presentation = editorVisibleSnapshotSegmentPresentation(
                    segment,
                    characterWidth,
                  )

                  return (
                    <span
                      className={presentation.className}
                      key={segmentIndex}
                      style={presentation.style}
                    >
                      {segment.text}
                    </span>
                  )
                })}
              </span>
            ))}
            {row.foldMarker?.collapsed ? (
              <span className='editor-virtualized-fold-placeholder'>...</span>
            ) : null}
          </div>
        ))}
        <EditorVisiblePaintLayers
          indentationGuidesEnabled={indentationGuidesEnabled}
          snapshot={snapshot}
        />
      </div>
    </div>
  )
}
