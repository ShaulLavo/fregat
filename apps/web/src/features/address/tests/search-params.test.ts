import { testWorkspaceToken } from '../../../../test/factories/workspace-address'
import { describe } from 'vitest'

import { expect, test } from '../../../../test/fixtures'

import { searchParamsFor, searchStateFor } from '@/features/address/utils/search-params'
import { emptyAddress, formatAddress, parseAddress } from '@workspace/client-core/address/grammar'

const BUFFER = {
  caseSensitive: true,
  excludeGlobText: '**/tests/**',
  includeGlobText: 'apps/web/**',
  matchMode: 'regex' as const,
  query: 'createStructuredError',
  wholeWord: false,
}

describe('search params', () => {
  test('carries the query, flags and globs', () => {
    expect(searchParamsFor(BUFFER)).toEqual({
      case: '1',
      in: 'apps/web/**',
      m: 'regex',
      q: 'createStructuredError',
      x: '**/tests/**',
    })
  })

  test('omits defaults so a plain search stays a short link', () => {
    expect(
      searchParamsFor({
        ...BUFFER,
        caseSensitive: false,
        excludeGlobText: '',
        includeGlobText: '',
        matchMode: 'literal',
      }),
    ).toEqual({ q: 'createStructuredError' })
  })

  test('is absent without a query — an empty search is not a place', () => {
    expect(searchParamsFor({ ...BUFFER, query: '' })).toBeNull()
    expect(searchParamsFor(null)).toBeNull()
  })

  test('round-trips through the state form', () => {
    expect(searchStateFor(searchParamsFor(BUFFER))).toMatchObject({
      caseSensitive: true,
      excludeGlobText: '**/tests/**',
      includeGlobText: 'apps/web/**',
      matchMode: 'regex',
      query: 'createStructuredError',
    })
  })

  // A link that prefilled a bulk-replace field is one click from data loss.
  test('has no field for replacement text or for results', () => {
    const encoded = JSON.stringify(searchParamsFor(BUFFER))

    expect(encoded).not.toContain('replace')
    expect(encoded).not.toContain('matches')
    expect(encoded).not.toContain('queryHistory')
  })
})

describe('the prefixed groups in the grammar', () => {
  test('round-trips s.* and log.* to a fixed point', () => {
    const href = `/~${testWorkspaceToken('platform')}/workbench/s?s.q=createStructuredError&s.m=regex&s.case=1&log.level=error&log.area=git`
    const once = formatAddress(parseAddress(href))

    expect(formatAddress(parseAddress(once))).toBe(once)
    expect(parseAddress(href).search).toEqual({ case: '1', m: 'regex', q: 'createStructuredError' })
    expect(parseAddress(href).logs).toEqual({ area: 'git', level: 'error' })
  })

  test('keeps the prefixed groups out of passthrough', () => {
    expect(
      parseAddress(`/~${testWorkspaceToken('p')}/workbench?s.q=a&log.level=error&decode=diffusion`)
        .passthrough,
    ).toEqual({ decode: 'diffusion' })
  })

  test('serializes the groups back with their prefixes', () => {
    const href = formatAddress({
      ...emptyAddress(),
      logs: { level: 'error' },
      mode: 'workbench',
      search: { q: 'x' },
      workspace: testWorkspaceToken('p'),
    })

    expect(href).toContain('s.q=x')
    expect(href).toContain('log.level=error')
  })
})
