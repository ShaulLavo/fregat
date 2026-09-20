import type { LogDashboardBreakdownItem, LogDashboardLevel } from '@workspace/contracts'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'

import type { LogsFilterState, LogTimeRange } from '@/features/logs/utils/filter-params'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { logBreakdownOptionValues } from '@/features/logs/utils/toolbar-options'
import { useOwnedText } from '@/hooks/use-owned-text'

type LogsToolbarProps = {
  areas: readonly LogDashboardBreakdownItem[]
  filters: LogsFilterState
  sources: readonly LogDashboardBreakdownItem[]
  onFiltersChange: (filters: LogsFilterState) => void
}

const timeRangeOptions: Array<{ label: string; value: LogTimeRange }> = [
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: 'All', value: 'all' },
]

const levelOptions: Array<{ label: string; value: LogDashboardLevel | 'all' }> = [
  { label: 'All levels', value: 'all' },
  { label: 'Errors', value: 'error' },
  { label: 'Warnings', value: 'warn' },
  { label: 'Info', value: 'info' },
  { label: 'Debug', value: 'debug' },
]

export function LogsToolbar({ areas, filters, sources, onFiltersChange }: LogsToolbarProps) {
  const sourceValues = logBreakdownOptionValues(sources, filters.source)
  const areaValues = logBreakdownOptionValues(areas, filters.area)
  const [searchText, changeSearch] = useOwnedText(filters.search, (search) =>
    onFiltersChange({ ...filters, search }),
  )

  return (
    <>
      <PaneBar border='bottom'>
        <InputGroup className='bg-background h-(--density-control-height-sm) min-w-0 flex-1'>
          <InputGroupAddon align='inline-start'>
            <MagnifyingGlassIcon className='size-(--icon-size-sm)' />
          </InputGroupAddon>
          <InputGroupInput
            aria-label='Search logs'
            autoCapitalize='off'
            autoComplete='off'
            autoCorrect='off'
            className='text-2xs h-full'
            placeholder='Search logs'
            spellCheck={false}
            value={searchText}
            onChange={(event) => changeSearch(event.target.value)}
          />
        </InputGroup>
        <Select
          items={timeRangeOptions}
          value={filters.timeRange}
          onValueChange={(timeRange) => {
            // base-ui hands back `null` when a selection is cleared; the toolbar has no unset range.
            if (timeRange === null) return
            onFiltersChange({ ...filters, timeRange })
          }}
        >
          {/* Fixed width: the label swings between `15m` and `All`, and the toolbar must not reflow. */}
          <SelectTrigger
            aria-label='Log time range'
            className='bg-background text-2xs w-[72px]'
            size='sm'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeRangeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={levelOptions}
          value={filters.level}
          onValueChange={(level) => {
            if (level === null) return
            onFiltersChange({ ...filters, level })
          }}
        >
          {/* Floor width: `Errors` is far shorter than `All levels`, and the row must not reflow. */}
          <SelectTrigger
            aria-label='Log level'
            className='bg-background text-2xs min-w-[98px]'
            size='sm'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {levelOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PaneBar>
      <PaneBar border='bottom'>
        <Select
          value={filters.source}
          onValueChange={(source) => {
            if (source === null) return
            onFiltersChange({ ...filters, source })
          }}
        >
          <SelectTrigger
            aria-label='Log source'
            className='bg-background text-2xs min-w-0 flex-1'
            size='sm'
          >
            <SelectValue>{filters.source === 'all' ? 'All sources' : filters.source}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All sources</SelectItem>
            {sourceValues.map((source) => (
              <SelectItem key={source} value={source}>
                {source}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.area}
          onValueChange={(area) => {
            if (area === null) return
            onFiltersChange({ ...filters, area })
          }}
        >
          <SelectTrigger
            aria-label='Log area'
            className='bg-background text-2xs min-w-0 flex-1'
            size='sm'
          >
            <SelectValue>{filters.area === 'all' ? 'All areas' : filters.area}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All areas</SelectItem>
            {areaValues.map((area) => (
              <SelectItem key={area} value={area}>
                {area}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PaneBar>
    </>
  )
}
