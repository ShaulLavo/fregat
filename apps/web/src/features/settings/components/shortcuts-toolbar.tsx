import { KeyboardIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@workspace/ui/components/input-group'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import { normalizedChord, type PlatformName } from '@workspace/client-core/commands/chord'
import type { KeyboardEvent, Ref } from 'react'

import { ShortcutActions } from '@/features/settings/components/shortcut-actions'
import { SHORTCUT_COLUMNS } from '@/features/settings/components/shortcut-row'
import { noteKeyboardEvent, useKeyboardSeen } from '@/features/settings/state/keyboard-seen'
import { recordingStep } from '@/features/settings/utils/shortcut-recording'
import { SHORTCUT_FILTERS, type ShortcutFilter } from '@/features/settings/utils/shortcut-rows'
import { formatChord } from '@/keymap/utils/format-keys'

const FILTER_LABELS: Readonly<Record<ShortcutFilter, string>> = {
  all: 'All',
  custom: 'Custom',
  conflicts: 'Conflicts',
  unassigned: 'Unassigned',
}

export type ShortcutSearch =
  | { readonly kind: 'text'; readonly query: string }
  | { readonly kind: 'keys'; readonly strokes: readonly string[] }

/**
 * Search, Record keys, the list's menu, the filters and the column labels. Sticky in the page's
 * one scroller, painted with the surface of the region that owns it.
 */
export function ShortcutsToolbar({
  counts,
  customized,
  filter,
  onFilter,
  onSearch,
  platform,
  ref,
  report,
  search,
}: {
  counts: Readonly<Record<ShortcutFilter, number>>
  customized: boolean
  filter: ShortcutFilter
  onFilter: (filter: ShortcutFilter) => void
  onSearch: (search: ShortcutSearch) => void
  platform: PlatformName
  ref?: Ref<HTMLDivElement>
  report: string
  search: ShortcutSearch
}) {
  const keyboardSeen = useKeyboardSeen()
  const recording = search.kind === 'keys'
  const recorded =
    recording && search.strokes.length > 0
      ? formatChord(normalizedChord(search.strokes.join(' '), platform), platform)
      : ''

  function recordSearch(event: KeyboardEvent<HTMLInputElement>) {
    noteKeyboardEvent(event.nativeEvent)
    if (search.kind !== 'keys' || event.nativeEvent.isComposing) return
    event.preventDefault()
    const step = recordingStep(search.strokes, event, platform)
    if (step.kind === 'record') onSearch({ kind: 'keys', strokes: step.strokes })
    if (step.kind === 'clear') onSearch({ kind: 'keys', strokes: [] })
    if (step.kind === 'close') onSearch({ kind: 'text', query: '' })
  }

  return (
    <div
      className='sticky top-0 z-10 -mx-(--density-section-padding) flex flex-col gap-1 bg-[var(--settings-surface,var(--color-background-solid))] px-(--density-section-padding) py-1'
      ref={ref}
    >
      <div className='flex min-w-0 items-center gap-1'>
        <InputGroup className='min-w-0 flex-1'>
          <InputGroupAddon align='inline-start'>
            <MagnifyingGlassIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            aria-label='Search keyboard shortcuts'
            autoCapitalize='off'
            autoComplete='off'
            autoCorrect='off'
            onChange={(event) => {
              if (!recording) onSearch({ kind: 'text', query: event.currentTarget.value })
            }}
            onKeyDown={recordSearch}
            placeholder={recording ? 'Press keys to search' : 'Search by name, id or keys'}
            readOnly={recording}
            spellCheck={false}
            value={recording ? recorded : search.query}
          />
          {keyboardSeen ? (
            <InputGroupAddon align='inline-end'>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InputGroupButton
                      aria-label='Record keys'
                      aria-pressed={recording}
                      className={cn(recording && 'bg-accent text-accent-foreground')}
                      onClick={() =>
                        onSearch(
                          recording ? { kind: 'text', query: '' } : { kind: 'keys', strokes: [] },
                        )
                      }
                      size='icon-xs'
                    >
                      <KeyboardIcon />
                    </InputGroupButton>
                  }
                />
                <TooltipContent>
                  {recording ? 'Stop recording keys' : 'Search by pressing keys'}
                </TooltipContent>
              </Tooltip>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <ShortcutActions customized={customized} report={report} />
      </div>
      <Tabs onValueChange={(value) => onFilter(value as ShortcutFilter)} value={filter}>
        <TabsList aria-label='Filter shortcuts' variant='segmented'>
          {SHORTCUT_FILTERS.map((id) => (
            <TabsTab key={id} value={id}>
              {FILTER_LABELS[id]}
              <span className='text-muted-foreground text-2xs font-mono tabular-nums'>
                {counts[id]}
              </span>
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
      <div
        aria-hidden
        className={cn(
          'text-muted-foreground hidden h-5 items-center gap-(--density-control-gap) px-(--density-row-padding-x) text-2xs',
          SHORTCUT_COLUMNS,
        )}
      >
        <span>Command</span>
        <span>Keys</span>
        <span>Where</span>
        <span>Source</span>
      </div>
    </div>
  )
}
