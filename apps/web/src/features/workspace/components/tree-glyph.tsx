// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
/** @jsxImportSource react */
import type { JSX } from 'react'

type TreeGlyphName = 'dot' | 'ellipsis'

const ELLIPSIS =
  'M5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M9.5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M14 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0'

/** The tree's own marks: the changed-descendant dot and the row menu's dots. */
export function TreeGlyphIcon({ name }: { name: TreeGlyphName }): JSX.Element {
  // A 6-unit viewport inside a 16-unit one, as the sprite nested it, so it lands on the same pixels.
  if (name === 'dot')
    return (
      <svg
        aria-hidden='true'
        data-icon-name='file-tree-icon-dot'
        height={6}
        viewBox='0 0 16 16'
        width={6}
      >
        <svg viewBox='0 0 6 6'>
          <circle cx='3' cy='3' r='3' />
        </svg>
      </svg>
    )

  return (
    <svg
      aria-hidden='true'
      data-icon-name='file-tree-icon-ellipsis'
      height={16}
      viewBox='0 0 16 16'
      width={16}
    >
      <path d={ELLIPSIS} />
    </svg>
  )
}
