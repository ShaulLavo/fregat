import { useElementWidth } from '@/hooks/use-element-width'
import { useMemo, type RefObject } from 'react'
import { searchPreviewMaxLength } from '@/features/search/utils/preview-length'

export function useSearchPreviewMaxLength(
  ref: RefObject<HTMLDivElement | null>,
  replaceVisible: boolean | undefined,
) {
  const width = useElementWidth(ref)

  return useMemo(() => searchPreviewMaxLength(width, replaceVisible), [replaceVisible, width])
}
