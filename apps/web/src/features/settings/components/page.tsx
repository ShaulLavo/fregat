import { descriptorFor, type SettingId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { XIcon } from '@phosphor-icons/react'
import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { DiagnosticsBanner } from '@/features/settings/components/diagnostics-banner'
import { ImportSection } from '@/features/settings/components/import-section'
import { MalformedBanner } from '@/features/settings/components/malformed-banner'
import { PageActions } from '@/features/settings/components/page-actions'
import { PageLoading } from '@/features/settings/components/page-loading'
import { ScopeTabs } from '@/features/settings/components/scope-tabs'
import { SettingsJsonView } from '@/features/settings/components/json-view'
import { SettingRow } from '@/features/settings/components/setting-row'
import { Status } from '@/features/settings/components/status'
import { ViewToggle } from '@/features/settings/components/view-toggle'
import { useHasWorkspace } from '@/features/settings/hooks/use-has-workspace'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useSettingsDocument } from '@/features/settings/hooks/use-settings-document'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { SettingsOwnerProvider } from '@/features/settings/providers/owner-provider'
import { useSettingsScope } from '@/features/settings/state/scope-store'
import { useSettingsView } from '@/features/settings/state/view-store'
import { isSettingAvailable } from '@/features/settings/utils/availability'
import { matchingSettingIds } from '@workspace/client-core/settings/search'
import { documentBackdrop } from '@/lib/platform/backdrop'
import { isDesktop } from '@/lib/platform/bridge'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import {
  selectSettingsCategory,
  useSettingsCategory,
} from '@/features/settings/state/category-store'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

/**
 * The settings tab: one document, two views.
 *
 * `tabId` and the editor props are passed through because the JSON view is a
 * real editor bound to this tab — not because the form needs them.
 */
export function SettingsPage({
  liveDocument = null,
  rootPath = '',
  tabId = '',
}: {
  liveDocument?: EditorRenderDocument | null
  rootPath?: string
  tabId?: string
} = {}) {
  const view = useSettingsView()
  const showJson = view === 'json' && tabId !== ''
  const editorOwner = useQueryClient()
  const settingsOwner = useSettingsOwner()
  const document = useSettingsDocument(showJson ? editorOwner : undefined)
  const projection = useSettingsProjection(showJson ? editorOwner : undefined)
  const { isSaving } = useSettingsActions()
  const scope = useSettingsScope()
  const editorHasWorkspace = useHasWorkspace()
  const hasWorkspace =
    showJson || editorOwner === settingsOwner
      ? editorHasWorkspace
      : Boolean(document.data?.layers.some((layer) => layer.id === 'workspace'))
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selectedCategory = useSettingsCategory()
  const { ref: focusTargetRef } = useFocusTarget<HTMLDivElement>(
    {
      area: 'settings',
      id: { kind: 'settings-page', tabId },
      onIntent: (intent) => {
        if (intent !== 'focus') return false

        const target = searchRef.current ?? rootRef.current
        if (!target) return false

        target.focus()
        return true
      },
    },
    tabId !== '' && !showJson,
  )
  // JSON has a nested Editor target. Its parent must not become an ambiguous peer.
  const setRootRef = useCallback(
    (element: HTMLDivElement | null) => {
      rootRef.current = element
      focusTargetRef(element)
    },
    [focusTargetRef],
  )

  if (document.isError) return <Status tone='destructive'>Settings could not be loaded.</Status>
  if (document.isPending || !projection) return <PageLoading showJson={showJson} />

  // `matchingSettingIds` already searches rows rather than keys, so a key edited
  // from another row is folded into its owner here rather than dropped.
  const environment = { backdrop: documentBackdrop(), isShell: isDesktop() }
  const visible = matchingSettingIds(query).filter(
    (id) =>
      (descriptorFor(id).visibility ?? 'user') !== 'internal' &&
      isSettingAvailable(id, environment),
  )
  const categories = groupByCategory(visible)
  const selectedFile = document.data.layers.find((layer) => layer.id === scope)?.file ?? null
  // An address can narrow the page to one category. Unknown or absent means all of
  // them, so a stale link degrades to the full page rather than to nothing.
  const shown = selectedCategory
    ? [...categories].filter(([category]) => category === selectedCategory)
    : [...categories]

  return (
    <div
      className='@container/settings flex h-full min-h-0 min-w-0 flex-col'
      ref={setRootRef}
      tabIndex={-1}
    >
      <header className='border-border compact:gap-1.5 compact:px-3 compact:pb-3 flex shrink-0 flex-col gap-2 border-b px-4 pt-2 pb-4 @max-3xl/settings:grid @max-3xl/settings:grid-cols-[minmax(0,1fr)_auto] @max-3xl/settings:[&_[data-slot=button]]:min-h-10 @max-3xl/settings:[&_input]:h-10 @max-3xl/settings:[&_input]:text-base'>
        {/* The tab's own action strip, above the scope tabs: these act on the tab,
            the row below picks which file the tab is showing. */}
        <div className='flex items-center justify-end gap-1 @max-3xl/settings:order-2'>
          {tabId ? <ViewToggle /> : null}
          <SettingsOwnerProvider
            key={showJson ? 'editor' : 'global'}
            queryClient={showJson ? editorOwner : settingsOwner}
          >
            <PageActions scope={scope} />
          </SettingsOwnerProvider>
        </div>
        <ScopeTabs hasWorkspace={hasWorkspace} />
        {showJson ? null : (
          <Input
            aria-label='Search settings'
            className='@max-3xl/settings:order-3 @max-3xl/settings:col-span-full'
            autoFocus
            ref={searchRef}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder='Search settings'
            value={query}
          />
        )}
        <div
          className={
            showJson
              ? 'hidden'
              : 'flex flex-wrap items-center gap-2 @max-3xl/settings:order-4 @max-3xl/settings:col-span-full'
          }
        >
          {/* `visible` is already query-filtered, so "of N" only says something while a
              category narrows the list further; otherwise it printed the same number twice. */}
          <p className='text-muted-foreground text-xs tabular-nums'>
            {selectedCategory ? `${shownCount(shown)} of ` : ''}
            {visible.length} {visible.length === 1 ? 'setting' : 'settings'}
          </p>
          {isSaving ? (
            <span className='text-muted-foreground flex items-center gap-1 text-xs'>
              <OrbitLoader className='size-3' label='Saving settings' />
              Saving
            </span>
          ) : null}
          {/* The only way out of a category a link pinned. Without it the page showed
              one section while the header counted every setting, and nothing in the UI
              could clear it — `selectSettingsCategory` had no caller but the applier. */}
          {selectedCategory ? (
            <Button
              aria-label={`Show all settings, not just ${selectedCategory}`}
              onClick={() => selectSettingsCategory(null)}
              size='sm'
              variant='secondary'
            >
              {selectedCategory}
              <XIcon aria-hidden />
            </Button>
          ) : null}
        </div>
      </header>

      {/* Escape returns to the search box from anywhere in the list, so a
          keyboard user is never more than one key from starting over. Captured
          on the container rather than per row — every control below would
          otherwise need its own handler, and a new widget would silently miss
          it. */}
      {showJson ? (
        <div className='flex min-h-0 flex-1 flex-col'>
          <div className='compact:px-3 compact:pt-3 px-4 pt-4'>
            <MalformedBanner layers={document.data.layers} />
          </div>
          <div className='min-h-0 flex-1'>
            <SettingsJsonView
              diagnostics={document.data.diagnostics}
              file={selectedFile}
              liveDocument={liveDocument}
              rootPath={rootPath}
              scope={scope}
              tabId={tabId}
            />
          </div>
        </div>
      ) : (
        <div
          className='compact:p-3 min-h-0 min-w-0 flex-1 overflow-y-auto p-4 @max-3xl/settings:[&_[data-slot=button]]:min-h-10 @max-3xl/settings:[&_[data-slot=select-trigger]]:min-h-10 @max-3xl/settings:[&_input]:h-10 @max-3xl/settings:[&_input]:text-base'
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            // Not while a control is mid-interaction: a recorder is capturing, and
            // a text field treats Escape as "discard my edit".
            if (event.defaultPrevented) return

            searchRef.current?.focus()
          }}
        >
          <MalformedBanner layers={document.data.layers} />
          <DiagnosticsBanner diagnostics={projection.diagnostics} />
          {shown.length === 0 ? (
            <Status>{emptySettingsMessage(query, selectedCategory)}</Status>
          ) : (
            shown.map(([category, ids]) => (
              <section className='compact:mb-4 mb-6' key={category}>
                <h2 className='text-foreground mb-1 text-sm font-semibold'>{category}</h2>
                {ids.includes('chat.keepImportedSessionsUpdated') ? <ImportSection /> : null}
                {ids.map((id) => (
                  <SettingRow id={id} key={id} snapshot={projection} />
                ))}
              </section>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A category filter and a search query can disagree: the query matches settings that
 * live in another section. Saying so beats an empty page under a header that claims
 * matches exist.
 */
function emptySettingsMessage(query: string, category: string | null) {
  if (category) return `No settings in ${category} match “${query}”.`

  return `No settings match “${query}”.`
}

/** What the list is actually showing, which a pinned category makes smaller. */
function shownCount(shown: readonly (readonly [string, SettingId[]])[]) {
  return shown.reduce((total, [, ids]) => total + ids.length, 0)
}

/**
 * Grouped by the descriptor's own `category`, not by key prefix. Deriving groups
 * from prefixes invents categories nobody chose and reshuffles the page whenever
 * a key is renamed.
 */
function groupByCategory(ids: readonly SettingId[]): Map<string, SettingId[]> {
  const categories = new Map<string, SettingId[]>()

  for (const id of ids) {
    const category = descriptorFor(id).category
    const existing = categories.get(category)
    if (existing) {
      existing.push(id)
      continue
    }

    categories.set(category, [id])
  }

  return categories
}
