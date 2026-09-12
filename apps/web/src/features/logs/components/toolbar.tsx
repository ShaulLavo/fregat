import type { LogDashboardBreakdownItem, LogDashboardLevel } from '@workspace/contracts'
import { ArrowClockwiseIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'

import type { LogsFilterState, LogTimeRange } from '@/features/logs/utils/filter-params'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { logBreakdownOptionValues } from '@/features/logs/utils/toolbar-options'

type LogsToolbarProps = {
  areas: readonly LogDashboardBreakdownItem[]
  filters: LogsFilterState
  refreshing: boolean
  sources: readonly LogDashboardBreakdownItem[]
  onFiltersChange: (filters: LogsFilterState) => void
  onRefresh: () => void
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

const selectClassName =
  'border-input bg-background text-foreground h-(--density-control-height-sm) border px-(--density-row-padding-x) text-2xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

export function LogsToolbar({
  areas,
  filters,
  refreshing,
  sources,
  onFiltersChange,
  onRefresh,
}: LogsToolbarProps) {
  const sourceValues = logBreakdownOptionValues(sources, filters.source)
  const areaValues = logBreakdownOptionValues(areas, filters.area)

  return (
    <div className='border-b p-(--density-control-gap)'>
      <div className='flex items-center gap-1'>
        <select
          aria-label='Log time range'
          className={`${selectClassName} w-[72px]`}
          value={filters.timeRange}
          onChange={(event) =>
            onFiltersChange({ ...filters, timeRange: event.target.value as LogTimeRange })
          }
        >
          {timeRangeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label='Log level'
          className={`${selectClassName} min-w-[98px]`}
          value={filters.level}
          onChange={(event) =>
            onFiltersChange({
              ...filters,
              level: event.target.value as LogDashboardLevel | 'all',
            })
          }
        >
          {levelOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Button
          aria-label='Refresh logs'
          className='shrink-0'
          disabled={refreshing}
          size='icon-sm'
          title='Refresh logs'
          type='button'
          variant='ghost'
          onClick={onRefresh}
        >
          <ArrowClockwiseIcon className='size-4' />
        </Button>
      </div>
      <div className='mt-(--density-section-gap) flex items-center gap-1'>
        <div className='relative min-w-0 flex-1'>
          <MagnifyingGlassIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2' />
          <Input
            aria-label='Search logs'
            className='bg-background text-2xs h-(--density-control-height-sm) pl-7'
            placeholder='Search logs'
            value={filters.search}
            onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
          />
        </div>
      </div>
      <div className='mt-(--density-section-gap) flex items-center gap-1'>
        <select
          aria-label='Log source'
          className={`${selectClassName} min-w-0 flex-1`}
          value={filters.source}
          onChange={(event) => onFiltersChange({ ...filters, source: event.target.value })}
        >
          <option value='all'>All sources</option>
          {sourceValues.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <select
          aria-label='Log area'
          className={`${selectClassName} min-w-0 flex-1`}
          value={filters.area}
          onChange={(event) => onFiltersChange({ ...filters, area: event.target.value })}
        >
          <option value='all'>All areas</option>
          {areaValues.map((area) => (
            <option key={area} value={area}>
              {area}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
