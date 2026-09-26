import {
  VirtualList,
  virtualRowInView,
  type VirtualListHandle,
} from '@workspace/ui/patterns/virtual-list'
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
  shortcutListWith,
  shortcutRowsWithChord,
  type ShortcutFilter,
  type ShortcutRow as ShortcutRowModel,
} from '@/features/settings/utils/shortcut-rows'
import { keyBindingResolution } from '@/keymap/active-bindings'
import type { PlatformCommandId } from '@/keymap/types'

/** A row's recorder (replacing its chord, or adding one to its command) or its menu. */
type Overlay = {
  readonly kind: 'change' | 'add' | 'menu'
  readonly rowId: string
  readonly anchor: HTMLElement
}

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
  const [activeId, setActiveId] = useState<string | null>(null)
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
  const overlayRow = overlay ? rows.find((row) => row.id === overlay.rowId) : undefined
  const recordMode = overlay && overlay.kind !== 'menu' ? overlay.kind : null
  const { report, unmapped, omitted } = {
    ...defaults,
    report: keyBindingResolution(defaults.bindings, overrides, platform).report,
  }

  function openRecorder(row: ShortcutRowModel, anchor: HTMLElement | null) {
    if (anchor) setOverlay({ kind: row.keys === null ? 'add' : 'change', rowId: row.id, anchor })
  }

  function rowById(rowId: string) {
    return rows.find((row) => row.id === rowId)
  }

  function rowElement(rowId: string) {
    return listRef.current?.querySelector<HTMLElement>(`[data-shortcut-row="${CSS.escape(rowId)}"]`)
  }

  const listbox = useListbox({
    activeId,
    containerRef: listRef,
    items: visible.map((row) => ({ id: row.id, label: row.title })),
    onActiveChange: setActiveId,
    onCommit: (rowId) => {
      const row = rowById(rowId)
      if (row) openRecorder(row, rowElement(rowId) ?? null)
    },
    onActiveKeyDown: (event: KeyboardEvent<HTMLDivElement>, rowId) => {
      const row = rowById(rowId)
      const anchor = rowElement(rowId)
      if (!row || !anchor) return
      if (event.key === 'Delete' && row.keys !== null) {
        event.preventDefault()
        setKeybinding(row.command, shortcutListWith(row, { remove: true }))
      }
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault()
        setOverlay({ kind: 'menu', rowId, anchor })
      }
    },
    role: 'listbox',
    scrollToIndex: (index) => {
      if (virtualRowInView(scrollRef?.current ?? null, index, geometry.stickyHeight)) return
      handleRef.current?.scrollToIndex(index, { align: 'auto' })
    },
    typeahead: true,
  })

  function nextList(row: ShortcutRowModel, mode: 'change' | 'add', keys: string) {
    return shortcutListWith(row, mode === 'add' ? { add: keys } : { replace: keys })
  }

  function preview(command: PlatformCommandId, list: readonly string[], keys: string) {
    const candidate = shortcutRows(defaults.bindings, { ...overrides, [command]: list }, platform)
    const takes = candidate
      .filter((row) => row.shadowedBy === command && row.command !== command)
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
          getKey={(row) => row.id}
          handleRef={handleRef}
          // Rows paint before the scroller is measured; the window is the page's upper bound.
          initialRect={{ width: 0, height: window.innerHeight }}
          items={visible}
          layout='flow'
          renderLayout={scrollRef ? ({ content }) => content : undefined}
          renderRow={(row) => (
            <ShortcutRow
              keptNote={row.keys ? kept(row.keys) : null}
              onChange={() => openRecorder(row, rowElement(row.id) ?? null)}
              onMenu={(anchor) => setOverlay({ kind: 'menu', rowId: row.id, anchor })}
              platform={platform}
              query={search.kind === 'text' ? search.query || pageQuery : pageQuery}
              row={row}
              rowProps={{
                ...listbox.rowProps(row.id),
                onMouseDown: (event) => {
                  listbox.rowProps(row.id).onMouseDown(event)
                  // Focusing the list selects its first row and scrolls to it, which would move the
                  // pressed row out from under the pointer before the click lands.
                  setActiveId(row.id)
                },
                onClick: (event) => {
                  listbox.rowProps(row.id).onClick(event)
                  if (!geometry.narrow) return
                  setOverlay({ kind: 'menu', rowId: row.id, anchor: event.currentTarget })
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
      {recordMode && overlay && overlayRow ? (
        <ShortcutRecorder
          adding={recordMode === 'add'}
          anchor={overlay.anchor}
          onClose={() => setOverlay(null)}
          onSave={(keys) => {
            setOverlay(null)
            setKeybinding(overlayRow.command, nextList(overlayRow, recordMode, keys))
          }}
          platform={platform}
          preview={(keys) =>
            preview(overlayRow.command, nextList(overlayRow, recordMode, keys), keys)
          }
          title={overlayRow.title}
        />
      ) : null}
      {overlay?.kind === 'menu' && overlayRow ? (
        <ShortcutMenu
          anchor={overlay.anchor}
          onChange={(mode) => setOverlay({ ...overlay, kind: mode })}
          // The menu closes as its item runs; an item that opened the recorder keeps it open.
          onClose={() => setOverlay((current) => (current?.kind === 'menu' ? null : current))}
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
