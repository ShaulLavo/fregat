import { filesystemPath } from '@/lib/documents/utils/identity'
import type { WorkspaceSearchEvent, WorkspaceSearchQuery } from '@workspace/contracts'
import { createWorkspaceSearchMatcher } from '@workspace/contracts'
import type { FindMatch } from '@/lib/file-system-types'
import { describe } from 'vitest'
import { expect, test as it } from '../../../../test/fixtures'

import {
  appendSearchMatch,
  fallbackEntries,
  PICKER_HIDDEN_SEARCH_EXCLUDE_GLOBS,
  searchEntryType,
  streamPickerSearchEntries,
  type WorkspaceSearchStream,
} from '@/features/file-picker/state/search'

describe('appendSearchMatch', () => {
  it('keeps only the first name match per path and tags it with the scope', () => {
    const collected: FindMatch[] = []
    const seen = new Set<string>()

    expect(appendSearchMatch(matchEvent('src/a.ts'), collected, seen, 'current')).toBe(true)
    expect(appendSearchMatch(matchEvent('src/a.ts'), collected, seen, 'current')).toBe(false)

    expect(collected).toHaveLength(1)
    expect(collected[0]).toMatchObject({ path: 'src/a.ts', searchScope: 'current' })
  })

  it('ignores content matches and non-match events', () => {
    const collected: FindMatch[] = []
    const seen = new Set<string>()

    expect(appendSearchMatch(matchEvent('a.ts', 'content'), collected, seen, 'system')).toBe(false)
    expect(appendSearchMatch(doneEvent(), collected, seen, 'system')).toBe(false)
    expect(collected).toHaveLength(0)
  })
})

describe('fallbackEntries', () => {
  it('hydrates matches into entries with a deterministic search version', () => {
    const entries = fallbackEntries(
      [{ ...nameMatch('src/button.ts'), mtimeMs: 5, size: 10, searchScope: 'current' }],
      'button',
    )

    expect(entries[0]).toMatchObject({
      name: 'button.ts',
      path: 'src/button.ts',
      version: 'search:5:10',
      searchScope: 'current',
    })
  })

  it('ranks fuzzy matches against the query', () => {
    const entries = fallbackEntries(
      [nameMatch('zzz/other.ts'), nameMatch('src/button.ts')],
      'button',
    )

    expect(entries.map((entry) => entry.path)[0]).toBe('src/button.ts')
  })
})

describe('searchEntryType', () => {
  it('restricts folder mode to directories and leaves file mode unfiltered', () => {
    expect(searchEntryType('folder')).toBe('directory')
    expect(searchEntryType('file')).toBeUndefined()
  })
})

describe('hidden search exclusions', () => {
  it('rejects a dot-prefixed segment at the root or below another folder', () => {
    const matcher = createWorkspaceSearchMatcher({
      excludeGlobs: PICKER_HIDDEN_SEARCH_EXCLUDE_GLOBS,
      query: 'config',
    })

    expect(matcher.pathMatches('.config/settings.json')).toBe(false)
    expect(matcher.pathMatches('src/.generated/types.ts')).toBe(false)
    expect(matcher.pathMatches('src/config.ts')).toBe(true)
  })
})

describe('streamPickerSearchEntries', () => {
  it('deduplicates streamed matches and emits incremental fallbacks', async () => {
    const search = stubStream([
      matchEvent('src/a.ts'),
      matchEvent('src/a.ts'),
      matchEvent('src/b.ts'),
      doneEvent(),
    ])
    const snapshots: number[] = []

    const result = await streamPickerSearchEntries(
      'src',
      'a',
      'file',
      new AbortController().signal,
      (entries) => snapshots.push(entries.length),
      { search },
    )

    expect(result.map((entry) => entry.path).sort()).toEqual(['src/a.ts', 'src/b.ts'])
    // One incremental emission per accepted (deduped) match.
    expect(snapshots).toEqual([1, 2])
  })

  it('uses the system scope when searching from the workspace root', async () => {
    let observedQuery: WorkspaceSearchQuery | null = null
    const search: WorkspaceSearchStream = (query) => {
      observedQuery = query
      return toStream([matchEvent('a.ts'), doneEvent()])
    }

    const result = await streamPickerSearchEntries(
      '',
      'a',
      'file',
      new AbortController().signal,
      () => undefined,
      {
        search,
      },
    )

    expect(observedQuery).toMatchObject({
      excludeGlobs: PICKER_HIDDEN_SEARCH_EXCLUDE_GLOBS,
      includeContent: false,
      includeNames: true,
      matchMode: 'literal',
      path: '',
      useWorkspaceIndex: false,
    })
    expect(result[0]).toMatchObject({ searchScope: 'system' })
  })

  it('leaves hidden paths eligible when the picker setting is enabled', async () => {
    const observedQueries: WorkspaceSearchQuery[] = []
    const search: WorkspaceSearchStream = (query) => {
      observedQueries.push(query)
      return toStream([doneEvent()])
    }

    await streamPickerSearchEntries(
      '',
      'env',
      'file',
      new AbortController().signal,
      () => undefined,
      { search, showHidden: true },
    )

    expect(observedQueries[0]?.excludeGlobs).toBeUndefined()
  })

  it('throws AbortError when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    const search = stubStream([matchEvent('a.ts'), doneEvent()])

    const promise = streamPickerSearchEntries(
      'src',
      'a',
      'file',
      controller.signal,
      () => controller.abort(),
      {
        search,
      },
    )

    await expect(promise).rejects.toThrow('Aborted')
  })

  it('swallows stream errors once the scoped signal has aborted', async () => {
    const controller = new AbortController()
    const search: WorkspaceSearchStream = async function* (_query, signal) {
      yield matchEvent('a.ts')
      controller.abort()
      // After abort the scoped signal is aborted; a thrown error must be swallowed.
      if (signal.aborted) throw new Error('stream interrupted')
      yield doneEvent()
    }

    await expect(
      streamPickerSearchEntries('src', 'a', 'file', controller.signal, () => undefined, { search }),
    ).rejects.toThrow('Aborted')
  })
})

function stubStream(events: WorkspaceSearchEvent[]): WorkspaceSearchStream {
  return () => toStream(events)
}

async function* toStream(events: WorkspaceSearchEvent[]): AsyncGenerator<WorkspaceSearchEvent> {
  for (const event of events) {
    yield event
  }
}

function matchEvent(path: string, kind: 'name' | 'content' = 'name'): WorkspaceSearchEvent {
  return { type: 'match', match: { ...nameMatch(path), kind } }
}

function doneEvent(): WorkspaceSearchEvent {
  return { type: 'done', count: 0, path: '', query: '', truncated: false }
}

function nameMatch(path: string): FindMatch {
  return { kind: 'name', path: filesystemPath(path), source: 'disk', type: 'file' }
}
