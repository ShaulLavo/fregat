// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
/** @jsxImportSource react */
import type { JSX } from 'react'

type TreeGlyphName = 'chevron' | 'dot' | 'ellipsis'

const CHEVRON =
  'M12.4697 5.46973C12.7626 5.17684 13.2374 5.17684 13.5303 5.46973C13.8232 5.76262 13.8232 6.23738 13.5303 6.53028L8.53028 11.5303C8.23738 11.8232 7.76262 11.8232 7.46973 11.5303L2.46973 6.53028C2.17684 6.23738 2.17684 5.76262 2.46973 5.46973C2.76262 5.17684 3.23738 5.17684 3.53028 5.46973L8 9.93946L12.4697 5.46973Z'
const ELLIPSIS =
  'M5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M9.5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M14 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0'

/** The tree's own marks: the folder chevron, the changed-descendant dot and the row menu's dots. */
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

  // `data-align-capitals` keys the chevron's nudge in the tree's sheet.
  const chevron = name === 'chevron'
  return (
    <svg
      aria-hidden='true'
      data-align-capitals={chevron ? 'false' : undefined}
      data-icon-name={chevron ? 'file-tree-icon-chevron' : 'file-tree-icon-ellipsis'}
      height={16}
      viewBox='0 0 16 16'
      width={16}
    >
      {chevron ? <path d={CHEVRON} fill='currentcolor' /> : <path d={ELLIPSIS} />}
    </svg>
  )
}
