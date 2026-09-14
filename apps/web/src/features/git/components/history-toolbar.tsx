import type { GitHistoryRef } from '@workspace/contracts'
import {
  ArrowClockwiseIcon,
  ArrowsOutSimpleIcon,
  CrosshairIcon,
  MagnifyingGlassIcon,
  XIcon,
} from '@phosphor-icons/react'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@workspace/ui/components/select'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@workspace/ui/components/input-group'
import { ToolbarButton } from '@/components/toolbar-button'
import { historyRefLabel } from '@/features/git/utils/history-presentation'

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
}) {
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
      <PaneBar border='bottom'>
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
      <PaneBar border='bottom'>
        <InputGroup className='h-(--density-control-height-sm) min-w-0 flex-1'>
          <InputGroupAddon>
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label='Search commit history'
            placeholder='Search commit history…'
            title='Search messages, authors, and commit IDs in the full selected history'
            maxLength={1024}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          {search ? (
            <InputGroupAddon align='inline-end'>
              <InputGroupButton
                aria-label='Clear history search'
                size='icon-xs'
                onClick={() => onSearchChange('')}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </PaneBar>
    </>
  )
}
