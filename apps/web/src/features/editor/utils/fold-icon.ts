import type { FoldGutterSvgIcon } from '@singapore-editor/gutters/fold-gutter'

// Phosphor CaretDown, bold. Path data keeps the icon library off the editor boot path.
export const FOLD_CHEVRON_ICON = {
  kind: 'svg',
  viewBox: '0 0 256 256',
  path: 'M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z',
} satisfies FoldGutterSvgIcon
