import type { SpinnerSize } from '@workspace/ui/components/spinner'

export const SPINNER_SIZES: readonly { readonly size: SpinnerSize; readonly use: string }[] = [
  { size: 'xs', use: 'Rows and running text' },
  { size: 'sm', use: 'A control’s icon slot' },
  { size: 'md', use: 'A panel waiting' },
  { size: 'lg', use: 'A whole surface waiting' },
]

export const SKELETON_ROW_WIDTHS = ['w-48', 'w-32', 'w-40', 'w-24'] as const
