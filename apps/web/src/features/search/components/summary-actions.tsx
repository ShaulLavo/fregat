import {
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CaretDownIcon,
  CaretUpIcon,
} from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import type { ReactNode } from 'react'

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
        <ArrowsOutLineVerticalIcon className='size-3.5' />
      </SummaryButton>
      <SummaryButton
        className={buttonClassName}
        disabled={!summary.canCollapse}
        label='Collapse all search results'
        onClick={collapseAllGroups}
      >
        <ArrowsInLineVerticalIcon className='size-3.5' />
      </SummaryButton>
      <SummaryButton
        className={buttonClassName}
        disabled={!summary.canNavigate}
        label='Previous match'
        onClick={selectPreviousMatch}
      >
        <CaretUpIcon className='size-3.5' />
      </SummaryButton>
      <SummaryButton
        className={buttonClassName}
        disabled={!summary.canNavigate}
        label='Next match'
        onClick={selectNextMatch}
      >
        <CaretDownIcon className='size-3.5' />
      </SummaryButton>
    </>
  )
}

function SummaryButton({
  children,
  className,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  className?: string
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button
      aria-label={label}
      className={cn('text-muted-foreground hover:text-foreground', className)}
      disabled={disabled}
      size='icon-sm'
      title={label}
      type='button'
      variant='ghost'
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
