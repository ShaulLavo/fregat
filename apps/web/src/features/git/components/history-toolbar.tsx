import { Spinner } from '@workspace/ui/components/spinner'
import type { GitHistoryRef } from '@workspace/contracts'
import { ArrowClockwiseIcon, ArrowsOutSimpleIcon, CrosshairIcon } from '@phosphor-icons/react'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@workspace/ui/components/select'
import { FilterField } from '@workspace/ui/patterns/filter-field'
import { ToolbarButton } from '@/components/toolbar-button'
import { historyRefLabel } from '@/features/git/utils/history-presentation'
import { useOwnedText } from '@/hooks/use-owned-text'

export function HistoryToolbar({
  refs,
  refName,
  search,
  busy,
  expanded,
  onRefChange,
  onSearchChange,
  onRefresh,
  onExpand,
  onFocusList,
}: {
  refs: readonly GitHistoryRef[]
  refName: string
  search: string
  busy: boolean
  expanded: boolean
  onRefChange: (value: string) => void
  onSearchChange: (value: string) => void
  onRefresh: () => void
  onExpand: () => void
  onFocusList: () => void
}) {
  const [searchText, changeSearch] = useOwnedText(search, onSearchChange)
  const choices = [
    { value: 'all', label: 'All branches & tags' },
    { value: 'HEAD', label: 'Current branch' },
    ...refs
      .filter((ref) => ref.kind !== 'head')
      .map((ref) => ({
        value: ref.name,
        label: `${ref.kind === 'tag' ? 'Tag: ' : ''}${historyRefLabel(ref)}`,
      })),
  ]
  return (
    <>
      <PaneBar>
        <Select
          value={refName}
          onValueChange={(value) => {
            if (value) onRefChange(value)
          }}
          items={choices}
        >
          <SelectTrigger
            size='sm'
            className='min-w-0 flex-1'
            aria-label='History reference'
            title={refName}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value} title={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {busy ? <Spinner label='Loading selected history' size='xs' /> : null}
        <ToolbarButton label='Go to current commit' onClick={() => onRefChange('HEAD')}>
          <CrosshairIcon />
        </ToolbarButton>
        <ToolbarButton label='Refresh history' disabled={busy} onClick={onRefresh}>
          <ArrowClockwiseIcon />
        </ToolbarButton>
        {!expanded ? (
          <ToolbarButton label='Expand commit graph' onClick={onExpand}>
            <ArrowsOutSimpleIcon />
          </ToolbarButton>
        ) : null}
      </PaneBar>
      <FilterField
        aria-label='Search commit history'
        placeholder='Search commit history…'
        title='Search messages, authors, and commit IDs in the full selected history'
        maxLength={1024}
        value={searchText}
        onValueChange={changeSearch}
        onArrowDown={onFocusList}
        blurBehavior='retain'
        clearLabel='Clear history search'
      />
    </>
  )
}
