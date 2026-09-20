import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useCommands } from '@/commands/hooks/use-commands'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { ReplaceDialog } from '@/search/components/replace-dialog'
import { Prompt } from '@/components/prompt'
import { Select } from '@/components/select'
import { LoadingState } from '@/components/loading-state'
import { EmptyState } from '@/components/empty-state'
import type { WorkbenchPaneProps } from '@/workbench/utils/pane-props'
import { createSearchWorkbench } from '@/search/state/workbench'
import { resultOptions, searchQuery, type SearchOptions } from '@/search/utils/results'

export function SearchPane({ session, rootPath, theme, enabled, onOpenFile }: WorkbenchPaneProps) {
  const commands = useCommands()
  const [store] = useState(() => createSearchWorkbench(session.client))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [options, setOptions] = useState<SearchOptions>({
    query: '',
    include: '',
    exclude: '',
    regex: false,
    caseSensitive: false,
    wholeWord: false,
  })
  const [selected, updateSelected] = useState(0)
  const latestSelected = useRef(0)
  function setSelected(value: number) {
    latestSelected.current = value
    updateSelected(value)
  }
  const [replacing, setReplacing] = useState(false)
  const current = state.key === JSON.stringify(searchQuery(rootPath, options))
  const rows = current ? resultOptions(state.matches) : []
  useEffect(() => () => store.dispose(), [store])
  useEffect(() => {
    const timeout = setTimeout(() => {
      const query = searchQuery(rootPath, options)
      if (store.getSnapshot().key === JSON.stringify(query)) return
      setSelected(0)
      void store.search(query)
    }, 150)
    return () => clearTimeout(timeout)
  }, [store, rootPath, options])
  const queryFocused = usePaneFocus({
    id: 'search-query',
    area: 'search',
    enabled: enabled && !replacing,
    textEntry: true,
  })
  const includeFocused = usePaneFocus({
    id: 'search-include',
    area: 'search',
    enabled: enabled && !replacing,
    textEntry: true,
  })
  const excludeFocused = usePaneFocus({
    id: 'search-exclude',
    area: 'search',
    enabled: enabled && !replacing,
    textEntry: true,
  })
  const focused = queryFocused || includeFocused || excludeFocused

  function closeReplacement() {
    setReplacing(false)
    commands.focus.request({
      kind: 'match',
      matches: (target) => target.widgetId === 'search-query',
    })
  }
  function open(index = latestSelected.current) {
    const match = rows[index]?.value
    if (match) onOpenFile(match.path, match.line)
  }
  function run() {
    void store.search(searchQuery(rootPath, options))
  }
  function move(amount: number) {
    setSelected(Math.max(0, Math.min(rows.length - 1, latestSelected.current + amount)))
  }
  useCommandHandlers(
    {
      'search.replace': {
        disabledReason: () =>
          state.kind !== 'ready' || !rows.length || state.truncated
            ? 'Wait for a complete search with matches before replacing.'
            : null,
        run: () => setReplacing(true),
      },
      'search.next': { run: () => move(1) },
      'search.previous': { run: () => move(-1) },
      'search.open': { run: () => open() },
      'search.refresh': { run },
      'search.toggleRegex': {
        run: () => setOptions((value) => ({ ...value, regex: !value.regex })),
      },
      'search.toggleCase': {
        run: () => setOptions((value) => ({ ...value, caseSensitive: !value.caseSensitive })),
      },
      'search.toggleWholeWord': {
        run: () => setOptions((value) => ({ ...value, wholeWord: !value.wholeWord })),
      },
    },
    enabled && !replacing,
  )
  return (
    <box id='workbench-search' flexDirection='column' flexGrow={1} minHeight={0}>
      <text fg={theme.primary} height={1}>
        Search · {options.regex ? 'regex' : 'literal'} ·{' '}
        {options.caseSensitive ? 'case sensitive' : 'ignore case'}
        {options.wholeWord ? ' · whole word' : ''}
      </text>
      <Prompt
        id='search-query'
        value={options.query}
        onChange={(query) => setOptions((value) => ({ ...value, query }))}
        onSubmit={(value) => {
          if (value === options.query && current && rows.length) {
            open()
            return
          }
          void store.search(searchQuery(rootPath, { ...options, query: value }))
        }}
        focused={queryFocused}
        placeholder='Search workspace…'
        theme={theme}
      />
      <Prompt
        id='search-include'
        value={options.include}
        onChange={(include) => setOptions((value) => ({ ...value, include }))}
        onSubmit={run}
        focused={includeFocused}
        placeholder='Include globs, e.g. **/*.ts'
        theme={theme}
      />
      <Prompt
        id='search-exclude'
        value={options.exclude}
        onChange={(exclude) => setOptions((value) => ({ ...value, exclude }))}
        onSubmit={run}
        focused={excludeFocused}
        placeholder='Exclude globs, e.g. **/generated/**'
        theme={theme}
      />
      {!options.query && (
        <EmptyState
          theme={theme}
          title='Search workspace'
          description='Type a query. Tab moves through include and exclude filters.'
        />
      )}
      {options.query && (!current || state.kind === 'loading') && (
        <LoadingState theme={theme} label='Searching workspace…' />
      )}
      {state.kind === 'failed' && <text fg={theme.destructive}>{state.message}</text>}
      {current && state.kind === 'ready' && rows.length === 0 && (
        <EmptyState
          theme={theme}
          title='No matches'
          description='Try another query or change the file filters.'
        />
      )}
      {rows.length > 0 && (
        <Select
          options={rows}
          selectedIndex={selected}
          onChange={setSelected}
          onSelect={open}
          navigateFromInput={focused && !replacing}
          flexGrow={1}
          minHeight={0}
          textColor={theme.foreground}
          selectedTextColor={theme.primary}
          selectedBackgroundColor={theme.accent}
        />
      )}
      {current && state.kind === 'ready' && (
        <text fg={theme.mutedForeground}>
          {rows.length} matches{state.truncated ? ' · result limit reached' : ''}
          {state.message ? ` · ${state.message}` : ''}
        </text>
      )}
      {replacing && (
        <ReplaceDialog
          client={session.client}
          query={searchQuery(rootPath, options)}
          matches={state.matches}
          searchKind={state.kind}
          searchTruncated={state.truncated}
          theme={theme}
          onClose={closeReplacement}
          onApplied={() => {
            closeReplacement()
            run()
          }}
        />
      )}
    </box>
  )
}
