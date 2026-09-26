import { VirtualList, type VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { matchingSettingIds } from '@workspace/client-core/settings/search'
import { use, useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { EmptyRow } from '@/features/settings/components/empty-row'
import { ShortcutMenu } from '@/features/settings/components/shortcut-menu'
import { ShortcutRecorder } from '@/features/settings/components/shortcut-recorder'
import { ShortcutRow } from '@/features/settings/components/shortcut-row'
import {
  ShortcutsToolbar,
  type ShortcutSearch,
} from '@/features/settings/components/shortcuts-toolbar'
import { UnmappedShortcuts } from '@/features/settings/components/unmapped-shortcuts'
import { useBrowserKept } from '@/features/settings/hooks/use-browser-kept'
import { useListGeometry } from '@/features/settings/hooks/use-list-geometry'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useShortcutRows } from '@/features/settings/hooks/use-shortcut-rows'
import { SettingsScrollerContext } from '@/features/settings/providers/scroller-context'
import { noteKeyboardEvent } from '@/features/settings/state/keyboard-seen'
import { useSettingsSearch } from '@/features/settings/state/search-store'
import { shortcutReport } from '@/features/settings/utils/shortcut-report'
import {
  matchingShortcutRows,
  shortcutFilterCounts,
  shortcutFilterMatches,
  shortcutPlacesLabel,
  shortcutRows,
  shortcutRowsWithChord,
  type ShortcutFilter,
  type ShortcutRow as ShortcutRowModel,
} from '@/features/settings/utils/shortcut-rows'
import { keyBindingResolution } from '@/keymap/active-bindings'
import type { PlatformCommandId } from '@/keymap/types'

type Overlay =
  | { readonly kind: 'record'; readonly command: PlatformCommandId; readonly anchor: HTMLElement }
  | { readonly kind: 'menu'; readonly command: PlatformCommandId; readonly anchor: HTMLElement }

/**
 * Every command and its keys, in the settings page's own scroller: a sticky toolbar, then one
 * windowed list. Rows record on Enter or double-click and open their menu on right-click, or on a
 * tap where the page is narrow.
 */
export function KeybindingSection() {
  const { defaults, overrides, platform, preset, rows } = useShortcutRows()
  const { setKeybinding } = useSettingsActions()
  const kept = useBrowserKept(platform)
  const pageQuery = useSettingsSearch()
  const scrollRef = use(SettingsScrollerContext)
  const listRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<VirtualListHandle>(null)
  const geometry = useListGeometry(scrollRef, listRef, toolbarRef)
  const [search, setSearch] = useState<ShortcutSearch>({ kind: 'text', query: '' })
  const [filter, setFilter] = useState<ShortcutFilter>('all')
  const [activeId, setActiveId] = useState<PlatformCommandId | null>(null)
  const [overlay, setOverlay] = useState<Overlay | null>(null)

  useEffect(() => {
    const note = (event: globalThis.KeyboardEvent) => noteKeyboardEvent(event)
    window.addEventListener('keydown', note, true)
    return () => window.removeEventListener('keydown', note, true)
  }, [])

  // Settings search finds commands too; the page's query narrows the list unless it named the
  // setting itself.
  const pageNarrows =
    pageQuery.trim() !== '' && !matchingSettingIds(pageQuery).includes('keybindings.overrides')
  const pageRows = pageNarrows ? matchingShortcutRows(rows, pageQuery, platform) : rows
  const searched = searchedRows(pageRows, search, platform)
  const visible = searched.filter((row) => shortcutFilterMatches(row, filter))
  const overlayRow = overlay ? rows.find((row) => row.command === overlay.command) : undefined
  const { report, unmapped, omitted } = {
    ...defaults,
    report: keyBindingResolution(defaults.bindings, overrides, platform).report,
  }

  function openRecorder(command: PlatformCommandId, anchor: HTMLElement | null) {
    if (anchor) setOverlay({ kind: 'record', command, anchor })
  }

  function rowElement(command: PlatformCommandId) {
    return listRef.current?.querySelector<HTMLElement>(`[data-shortcut-command="${command}"]`)
  }

  const listbox = useListbox({
    activeId,
    containerRef: listRef,
    items: visible.map((row) => ({ id: row.command, label: row.title })),
    onActiveChange: setActiveId,
    onCommit: (command) => openRecorder(command, rowElement(command) ?? null),
    onActiveKeyDown: (event: KeyboardEvent<HTMLDivElement>, command) => {
      const anchor = rowElement(command)
      if (!anchor) return
      if (event.key === 'Delete') {
        event.preventDefault()
        setKeybinding(command, null)
      }
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault()
        setOverlay({ kind: 'menu', command, anchor })
      }
    },
    role: 'listbox',
    scrollToIndex: (index) => handleRef.current?.scrollToIndex(index, { align: 'auto' }),
    typeahead: true,
  })

  function preview(command: PlatformCommandId, keys: string) {
    const candidate = shortcutRows(defaults.bindings, { ...overrides, [command]: keys }, platform)
    const takes = candidate
      .filter((row) => row.shadowedBy === command)
      .map((row) => ({ title: row.title, where: shortcutPlacesLabel(row.places) }))

    return { kept: kept(keys), takes }
  }

  return (
    <div className='flex w-full min-w-0 flex-col'>
      <p className='text-muted-foreground pb-1 text-xs'>
        <span className='@max-3xl/settings:hidden'>
          Enter or double-click changes a shortcut; right-click for more.
        </span>
        <span className='@3xl/settings:hidden'>Tap a command for its actions.</span>
      </p>
      <ShortcutsToolbar
        counts={shortcutFilterCounts(searched)}
        customized={Object.keys(overrides).length > 0}
        filter={filter}
        onFilter={setFilter}
        onSearch={setSearch}
        platform={platform}
        ref={toolbarRef}
        report={shortcutReport(report, unmapped, omitted)}
        search={search}
      />
      <div {...listbox.containerProps} aria-label='Keyboard shortcuts' className='focus-ring-inset'>
        {visible.length === 0 ? <EmptyRow>No commands match this search.</EmptyRow> : null}
        <VirtualList
          activeIndex={listbox.activeIndex}
          estimateSize={geometry.narrow ? () => 48 : undefined}
          fade={false}
          getKey={(row) => row.command}
          handleRef={handleRef}
          // Rows paint before the scroller is measured; the window is the page's upper bound.
          initialRect={{ width: 0, height: window.innerHeight }}
          items={visible}
          layout='flow'
          renderLayout={scrollRef ? ({ content }) => content : undefined}
          renderRow={(row) => (
            <ShortcutRow
              keptNote={row.keys[0] ? kept(row.keys[0]) : null}
              onChange={() => openRecorder(row.command, rowElement(row.command) ?? null)}
              onMenu={(anchor) => setOverlay({ kind: 'menu', command: row.command, anchor })}
              platform={platform}
              query={search.kind === 'text' ? search.query || pageQuery : pageQuery}
              row={row}
              rowProps={{
                ...listbox.rowProps(row.command),
                onClick: (event) => {
                  listbox.rowProps(row.command).onClick(event)
                  if (geometry.narrow) {
                    // The menu starts listening for outside presses during this click.
                    event.stopPropagation()
                    setOverlay({ kind: 'menu', command: row.command, anchor: event.currentTarget })
                  }
                },
              }}
            />
          )}
          scrollMargin={geometry.scrollMargin}
          scrollPaddingStart={geometry.stickyHeight}
          scrollRef={scrollRef ?? undefined}
        />
      </div>
      {preset === 'vscode' ? <UnmappedShortcuts platform={platform} unmapped={unmapped} /> : null}
      {overlay?.kind === 'record' && overlayRow ? (
        <ShortcutRecorder
          adding={overlayRow.keys.length === 0}
          anchor={overlay.anchor}
          onClose={() => setOverlay(null)}
          onSave={(keys) => {
            setOverlay(null)
            setKeybinding(overlayRow.command, keys)
          }}
          platform={platform}
          preview={(keys) => preview(overlayRow.command, keys)}
          title={overlayRow.title}
        />
      ) : null}
      {overlay?.kind === 'menu' && overlayRow ? (
        <ShortcutMenu
          anchor={overlay.anchor}
          onChange={() => setOverlay({ ...overlay, kind: 'record' })}
          onClose={() => setOverlay(null)}
          onShowConflicts={(keys) => {
            setOverlay(null)
            setFilter('conflicts')
            setSearch({ kind: 'keys', strokes: keys.split(' ') })
          }}
          row={overlayRow}
        />
      ) : null}
    </div>
  )
}

function searchedRows(
  rows: readonly ShortcutRowModel[],
  search: ShortcutSearch,
  platform: Parameters<typeof shortcutRows>[2],
): readonly ShortcutRowModel[] {
  if (search.kind === 'text') return matchingShortcutRows(rows, search.query, platform)
  if (search.strokes.length === 0) return rows

  return shortcutRowsWithChord(rows, search.strokes.join(' '), platform)
}
