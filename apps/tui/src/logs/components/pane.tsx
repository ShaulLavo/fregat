import type { LogEventDetail } from '@workspace/contracts'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useSettingValue } from '@/settings/hooks/use-setting-value'
import { logFilters } from '@/logs/utils/filters'
import { LogDetail } from '@/logs/components/detail'
import { useCommands } from '@/commands/hooks/use-commands'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { Select } from '@/components/select'
import { Prompt } from '@/components/prompt'
import { Dialog } from '@/components/dialog'
import { LoadingState } from '@/components/loading-state'
import { EmptyState } from '@/components/empty-state'
import type { SettingsSession } from '@/connection/state/session'
import { createLogsWorkbench } from '@/logs/state/workbench'
import { logHistogram, logRow } from '@/logs/utils/events'
import type { Theme } from '@/theme/utils/theme'

export function LogsPane({
  session,
  rootPath,
  theme,
  enabled,
}: {
  session: SettingsSession
  rootPath: string
  theme: Theme
  enabled: boolean
}) {
  const commands = useCommands()
  const [store] = useState(() => createLogsWorkbench(session.client))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const connection = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const owner = connection.kind === 'ready' ? connection.owner : null
  const timeRange = useSettingValue(owner, 'logs.defaultTimeRange')
  const slowMs = useSettingValue(owner, 'logs.slowThresholdMs')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const latestSelectedId = useRef<string | null>(null)
  const [search, setSearch] = useState('')
  const [paused, setPaused] = useState(false)
  const [detail, setDetail] = useState<LogEventDetail | null>(null)
  const options = state.result.events.map((event) => ({
    name: logRow(event),
    description: event.errorMessage ?? '',
    value: event.id,
  }))
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === selectedId),
  )
  function setSelected(index: number) {
    latestSelectedId.current = options[index]?.value ?? null
    setSelectedId(latestSelectedId.current)
  }
  useEffect(() => () => store.dispose(), [store])
  useEffect(() => {
    const timer = setTimeout(() => {
      void store.refresh(logFilters(search, timeRange, slowMs), paused)
    }, 150)
    return () => clearTimeout(timer)
  }, [store, search, paused, timeRange, slowMs])
  const focused = usePaneFocus({
    id: 'logs-filter',
    area: 'logs',
    textEntry: true,
    enabled: enabled && !detail,
  })
  useCommandFocus(
    {
      screen: 'workbench',
      environmentId: connection.kind === 'ready' ? connection.descriptor.environmentId : '',
      projectId: rootPath,
      id: 'logs-json',
      area: 'dialog',
      textEntry: false,
      overlay: true,
      focus: () => detail !== null,
    },
    enabled && !!detail,
  )
  function move(amount: number) {
    setSelected(Math.max(0, Math.min(options.length - 1, selected + amount)))
  }
  function open(index?: number) {
    const id =
      index === undefined ? (latestSelectedId.current ?? options[0]?.value) : options[index]?.value
    setDetail(id ? (state.result.detailsById[id] ?? null) : null)
  }
  useCommandHandlers(
    {
      'logs.next': { run: () => move(1) },
      'logs.previous': { run: () => move(-1) },
      'logs.open': { run: () => open() },
      'logs.refresh': { run: () => store.refresh(logFilters(search, timeRange, slowMs), paused) },
      'logs.pause': { run: () => setPaused((value) => !value) },
    },
    enabled && !detail,
  )
  return (
    <box flexDirection='column' flexGrow={1} minHeight={0}>
      <text fg={theme.primary} height={1}>
        Logs · {paused ? 'paused' : (state.live && 'live') || 'connecting'} · environment-wide
      </text>
      <Prompt
        id='logs-filter'
        value={search}
        onChange={setSearch}
        onSubmit={() => open()}
        placeholder='Filter logs…'
        theme={theme}
        focused={focused && !detail}
      />
      {state.summary && (
        <text
          fg={theme.mutedForeground}
          height={2}
        >{`${logHistogram(state.summary)}\n${state.result.total} events · ${state.summary.errorCount} errors · ${state.summary.warnCount} warnings`}</text>
      )}
      {state.kind === 'loading' && <LoadingState theme={theme} label='Reading logs…' />}
      {state.kind === 'failed' && <text fg={theme.destructive}>{state.message}</text>}
      {state.kind === 'ready' && options.length === 0 && (
        <EmptyState
          theme={theme}
          title='No matching logs'
          description='New events will appear while live tail is connected.'
        />
      )}
      {options.length > 0 && (
        <Select
          options={options}
          selectedIndex={selected}
          onChange={setSelected}
          onSelect={open}
          navigateFromInput={focused && !detail}
          flexGrow={1}
          minHeight={0}
          showDescription={false}
          textColor={theme.foreground}
          selectedTextColor={theme.primary}
          selectedBackgroundColor={theme.accent}
        />
      )}
      {state.kind !== 'failed' && state.message && <text fg={theme.warning}>{state.message}</text>}
      {detail && (
        <Dialog
          title='Log event'
          theme={theme}
          onClose={() => {
            setDetail(null)
            commands.focus.request({
              kind: 'match',
              matches: (target) => target.widgetId === 'logs-filter',
            })
          }}
          width={100}
          height={26}
        >
          <LogDetail value={detail.rawJson} theme={theme} enabled={enabled} />
        </Dialog>
      )}
    </box>
  )
}
