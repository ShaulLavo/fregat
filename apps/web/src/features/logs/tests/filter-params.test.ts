import { describe, expect, it } from 'vitest'

import { defaultLogsFilterState } from '@/features/logs/utils/filter-params'
import {
  logDashboardFilters,
  logFilterQuery,
  logToolbarOptionFilters,
} from '@workspace/client-core/logs/filters'

describe('logDashboardFilters', () => {
  it('serializes selected filters and relative time ranges', () => {
    const filters = logDashboardFilters(
      {
        area: 'git',
        level: 'warn',
        search: '  status failed  ',
        slowMs: 750,
        source: 'be',
        timeRange: '15m',
      },
      Date.parse('2026-05-25T10:00:00.000Z'),
    )

    expect(filters).toEqual({
      areas: ['git'],
      levels: ['warn'],
      search: 'status failed',
      since: '2026-05-25T09:45:00.000Z',
      slowMs: 750,
      sources: ['be'],
    })
  })

  it('omits all-selection and empty search filters', () => {
    expect(
      logDashboardFilters({
        ...defaultLogsFilterState(),
        search: '   ',
        timeRange: 'all',
      }),
    ).toEqual({ slowMs: 500 })
  })
})

describe('logFilterQuery', () => {
  it('normalizes empty arrays and trims text search for route query params', () => {
    expect(
      logFilterQuery({
        areas: [],
        levels: [],
        search: '  render failed  ',
        since: '2026-05-25T09:00:00.000Z',
        sources: ['fe'],
        until: '2026-05-25T10:00:00.000Z',
      }),
    ).toEqual({
      areas: undefined,
      levels: undefined,
      search: 'render failed',
      since: '2026-05-25T09:00:00.000Z',
      slowMs: undefined,
      sources: ['fe'],
      until: '2026-05-25T10:00:00.000Z',
    })
  })
})

describe('logToolbarOptionFilters', () => {
  it('keeps option counts independent from selected source and area filters', () => {
    expect(
      logToolbarOptionFilters({
        areas: ['editor'],
        levels: ['error'],
        search: 'failed',
        since: '2026-05-25T09:00:00.000Z',
        slowMs: 500,
        sources: ['client'],
        until: '2026-05-25T10:00:00.000Z',
      }),
    ).toEqual({
      levels: ['error'],
      search: 'failed',
      since: '2026-05-25T09:00:00.000Z',
      slowMs: 500,
      until: '2026-05-25T10:00:00.000Z',
    })
  })
})
