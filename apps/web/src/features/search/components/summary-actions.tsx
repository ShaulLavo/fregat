import {
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CaretDownIcon,
  CaretUpIcon,
} from '@phosphor-icons/react'
import { SummaryButton } from '@/features/search/components/summary-button'
import { useSearchSummaryModel } from '@/features/search/hooks/use-summary-model'
import { useSearchBufferState } from '@/features/search/state/buffer-state'

export function SearchSummaryActions({
  buttonClassName,
  rootPath,
}: {
  buttonClassName?: string
  rootPath: string
}) {
  const collapseAllGroups = useSearchBufferState((state) => state.collapseAllGroups)
  const expandAllGroups = useSearchBufferState((state) => state.expandAllGroups)
  const selectNextMatch = useSearchBufferState((state) => state.selectNextMatch)
  const selectPreviousMatch = useSearchBufferState((state) => state.selectPreviousMatch)
  const summary = useSearchSummaryModel(rootPath)

  return (
    <>
      <SummaryButton
        className={buttonClassName}
        disabled={!summary.canExpand}
        label='Expand all search results'
        onClick={expandAllGroups}
      >
        <ArrowsOutLineVerticalIcon className='size-(--icon-size-sm)' />
      </SummaryButton>
      <SummaryButton
        className={buttonClassName}
        disabled={!summary.canCollapse}
        label='Collapse all search results'
        onClick={collapseAllGroups}
      >
        <ArrowsInLineVerticalIcon className='size-(--icon-size-sm)' />
      </SummaryButton>
      <SummaryButton
        className={buttonClassName}
        disabled={!summary.canNavigate}
        label='Previous match'
        onClick={selectPreviousMatch}
      >
        <CaretUpIcon className='size-(--icon-size-sm)' />
      </SummaryButton>
      <SummaryButton
        className={buttonClassName}
        disabled={!summary.canNavigate}
        label='Next match'
        onClick={selectNextMatch}
      >
        <CaretDownIcon className='size-(--icon-size-sm)' />
      </SummaryButton>
    </>
  )
}
