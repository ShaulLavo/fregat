// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
/** @jsxImportSource react */
import type { FileTreeLayoutStickyRow, FileTreeVisibleRow } from '@workspace/tree'
import type { JSX } from 'react'

import { TreeRow, type TreeRenderRowFrame } from '@/features/workspace/components/tree-row'
import { getTreeRowPath } from '@/features/workspace/utils/tree-row-identity'

/**
 * Pinned ancestor folders over the scroller. A row pushed up by the next folder is clipped at its
 * own slot so it never paints over the rows above it.
 */
export function TreeStickyOverlay({
  frame,
  height,
  itemHeight,
  rows,
}: {
  readonly frame: TreeRenderRowFrame
  readonly height: number
  readonly itemHeight: number
  readonly rows: readonly FileTreeLayoutStickyRow<FileTreeVisibleRow>[]
}): JSX.Element {
  return (
    <div aria-hidden='true' data-file-tree-sticky-overlay='true'>
      <div data-file-tree-sticky-overlay-content='true' style={{ height: `${height}px` }}>
        {rows.map((entry, index) => (
          <TreeRow
            key={`sticky:${getTreeRowPath(entry.row)}`}
            frame={frame}
            row={entry.row}
            options={{
              mode: 'sticky',
              style: {
                clipPath:
                  entry.top < index * itemHeight
                    ? `inset(${index * itemHeight - entry.top}px 0 0)`
                    : undefined,
                left: '0',
                position: 'absolute',
                right: '0',
                top: `${entry.top}px`,
                zIndex: `${rows.length - index}`,
              },
            }}
          />
        ))}
      </div>
    </div>
  )
}
