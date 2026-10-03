import { MCP_CATEGORY } from '@/features/settings/utils/mcp'
import { SettingsDisplayProvider } from '@/features/settings/providers/display-provider'
import { useReloadView } from '@/features/settings/hooks/use-reload-view'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { usePresentation } from '@workspace/ui/patterns/sheet'
import { workspaceRoot } from '@/lib/documents/utils/identity'
import type { TabId, WorkspaceRoot } from '@/lib/documents/utils/types'
import { useNavigation } from '@/hooks/use-navigation'
import { useSettingsSearch, selectSettingsSearch } from '@/features/settings/state/search-store'
import { Button } from '@workspace/ui/components/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { Spinner } from '@workspace/ui/components/spinner'
import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { DiagnosticsBanner } from '@/features/settings/components/diagnostics-banner'
import { MalformedBanner } from '@/features/settings/components/malformed-banner'
import { PageActions } from '@/features/settings/components/page-actions'
import { PageHeader } from '@/features/settings/components/page-header'
import { PageLoading } from '@/features/settings/components/page-loading'
import { ScopeTabs } from '@/features/settings/components/scope-tabs'
import { SettingsJsonView } from '@/features/settings/components/json-view'
import { CategorySection } from '@/features/settings/components/category-section'
import {
  formCategories,
  mountCost,
  mountedCategories,
  type FormCategories,
} from '@/features/settings/utils/form-categories'
import { useShortcutRows } from '@/features/settings/hooks/use-shortcut-rows'
import { SettingsScrollerContext } from '@/features/settings/providers/scroller-context'
import { StatusMessage } from '@/components/status-message'
import { ViewToggle } from '@/features/settings/components/view-toggle'
import { useHasWorkspace } from '@/features/settings/hooks/use-has-workspace'
import { useSettingsSaving } from '@/features/settings/hooks/use-settings-saving'
import { useHeldDisplay } from '@/features/settings/hooks/use-held-display'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { SettingsOwnerProvider } from '@/features/settings/providers/owner-provider'
import { writableSettingsScope } from '@/features/settings/state/scope-store'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import { useSettingsCategory } from '@/features/settings/state/category-store'
import { ProjectSection } from '@/features/settings/components/project-section'
import { selectSettingsProject, useSettingsProject } from '@/lib/project-settings/state/selection'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

/**
 * The settings tab: one document, two views.
 *
 * `tabId` and the editor props are passed through because the JSON view is a
 * real editor bound to this tab — not because the form needs them.
 */
export function SettingsPage({
  active = true,
  liveDocument = null,
  rootPath = workspaceRoot(''),
  tabId,
}: {
  active?: boolean
  liveDocument?: EditorRenderDocument | null
  rootPath?: WorkspaceRoot
  tabId?: TabId
} = {}) {
  const navigation = useNavigation()
  const phone = usePresentation() === 'sheet'
  const editorOwner = useQueryClient()
  const settingsOwner = useSettingsOwner()
  const {
    document,
    defaultsError,
    projection,
    showJson,
    scope,
    owner,
    pending,
    liveDocument: shownDocument,
  } = useHeldDisplay(tabId, liveDocument)
  const isSaving = useSettingsSaving(owner)
  const editorHasWorkspace = useHasWorkspace()
  const hasWorkspace =
    showJson || editorOwner === settingsOwner
      ? editorHasWorkspace
      : Boolean(document.data?.layers.some((layer) => layer.id === 'workspace'))
  const query = useSettingsSearch()
  // Defer the list so search keystrokes can paint before matching rows render.
  // The old list stays whole until the new list commits.
  const shownQuery = useDeferredValue(query)
  const ready = Boolean(document.data && projection)
  const setQuery = selectSettingsSearch
  const searchRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selectedCategory = useSettingsCategory()
  const project = useSettingsProject()
  const shortcuts = useShortcutRows()

  // compiler:memos: the compiler leaves this call unmemoized, and `CategorySection` skips its rows
  // on each mounting pass only while its `ids` keep their identity.
  const { shown, showPush, visible } = useMemo(
    () => formCategories(shownQuery, selectedCategory, shortcuts),
    [shownQuery, selectedCategory, shortcuts],
  )

  // The first screen of rows mounts with the page; the rest follow a pass at a time in
  // transitions, which React time-slices and commits apart, so no one task lays out every row.
  const [rowBudget, setRowBudget] = useState(FIRST_SCREEN_ROWS)
  const complete = rowBudget >= mountCost(shown)
  const formPending = pending || (!showJson && !project && !complete)
  useEffect(() => {
    if (!ready || complete) return
    startTransition(() => setRowBudget((budget) => budget + ROWS_PER_PASS))
  }, [ready, complete, rowBudget])
  const scrollRef = useReloadView(owner, ready && complete)
  const { ref: focusTargetRef } = useFocusTarget<HTMLDivElement>(
    {
      area: 'settings',
      id: { kind: 'settings-page', tabId: tabId ?? '' },
      onIntent: (intent) => {
        if (intent !== 'focus') return false

        const target = searchRef.current ?? rootRef.current
        if (!target) return false

        target.focus()
        return true
      },
    },
    tabId !== undefined && !showJson,
  )
  // JSON has a nested Editor target. Its parent must not become an ambiguous peer.
  const setRootRef = (element: HTMLDivElement | null) => {
    rootRef.current = element
    focusTargetRef(element)
  }

  if (defaultsError)
    return <StatusMessage tone='destructive'>Defaults could not be loaded.</StatusMessage>
  if (document.isError && !document.data)
    return <StatusMessage tone='destructive'>Settings could not be loaded.</StatusMessage>
  if (!document.data || !projection) return <PageLoading showJson={showJson} />

  const selectedFile = document.data.layers.find((layer) => layer.id === scope)?.file ?? null
  const onlyMcp = shown.length === 1 && shown[0]?.[0] === MCP_CATEGORY
  const onlyUsage = shown.length === 1 && shown[0]?.[0] === 'Usage'

  return (
    <SettingsDisplayProvider queryClient={owner} scope={scope} view={showJson ? 'json' : 'form'}>
      <ToolPane
        className='@container/settings h-full min-w-0'
        bodyClassName='flex flex-col'
        scroll={false}
        ref={setRootRef}
        tabIndex={-1}
        header={
          <PageHeader
            actions={
              <div className='flex items-center justify-end gap-1'>
                {formPending ? <Spinner label='Loading settings view' size='xs' /> : null}
                {tabId ? <ViewToggle /> : null}
                <SettingsOwnerProvider key={showJson ? 'editor' : 'global'} queryClient={owner}>
                  {project ? null : <PageActions scope={writableSettingsScope(scope)} />}
                </SettingsOwnerProvider>
              </div>
            }
            scope={<ScopeTabs hasDefaults={tabId !== undefined} hasWorkspace={hasWorkspace} />}
            search={
              showJson ? null : (
                <InputGroup className='min-w-0 flex-1'>
                  <InputGroupAddon align='inline-start'>
                    <MagnifyingGlassIcon aria-hidden />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label='Search settings'
                    autoCapitalize='off'
                    autoComplete='off'
                    autoCorrect='off'
                    autoFocus={active && !phone}
                    ref={searchRef}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder='Search settings'
                    spellCheck={false}
                    value={query}
                  />
                </InputGroup>
              )
            }
            summary={
              showJson ? null : (
                <div className='flex flex-wrap items-center gap-2'>
                  {/* `visible` is already query-filtered, so "of N" only says something while a
              category narrows the list further; otherwise it printed the same number twice. */}
                  <p className='text-muted-foreground text-xs tabular-nums'>
                    {project ? 'Project settings' : null}
                    {!project && onlyUsage ? 'Usage report' : null}
                    {!project && onlyMcp ? MCP_CATEGORY : null}
                    {!project && !onlyUsage && !onlyMcp && (
                      <>
                        {selectedCategory ? `${shownCount(shown)} of ` : ''}
                        {visible.length} {visible.length === 1 ? 'setting' : 'settings'}
                      </>
                    )}
                  </p>
                  {isSaving ? (
                    <span className='text-muted-foreground flex items-center gap-1 text-xs'>
                      <Spinner size='xs' label='Saving settings' />
                      Saving
                    </span>
                  ) : null}
                  {project ? (
                    <Button
                      aria-label='Show all settings'
                      onClick={() => selectSettingsProject(null)}
                      size='sm'
                      variant='secondary'
                    >
                      {project.title}
                      <XIcon aria-hidden />
                    </Button>
                  ) : null}
                  {/* Clear a category supplied by an incoming address. */}
                  {selectedCategory ? (
                    <Button
                      aria-label={`Clear the ${selectedCategory} filter and show every setting`}
                      onClick={() => void navigation.setSettingsCategory(null)}
                      size='sm'
                      variant='secondary'
                    >
                      {selectedCategory}
                      <XIcon aria-hidden />
                    </Button>
                  ) : null}
                </div>
              )
            }
          />
        }
      >
        {/* Escape returns to the search box from anywhere in the list, so a
          keyboard user is never more than one key from starting over. Captured
          on the container rather than per row — every control below would
          otherwise need its own handler, and a new widget would silently miss
          it. */}
        {showJson && tabId !== undefined ? (
          <div className='flex min-h-0 flex-1 flex-col'>
            <div className='px-(--density-section-padding) pt-(--density-section-padding)'>
              <MalformedBanner layers={document.data.layers} />
            </div>
            <div className='min-h-0 flex-1'>
              <SettingsJsonView
                active={active}
                diagnostics={document.data.diagnostics}
                file={selectedFile}
                liveDocument={shownDocument}
                rootPath={rootPath}
                scope={scope}
                tabId={tabId}
              />
            </div>
          </div>
        ) : (
          <div
            aria-label='Settings form'
            aria-busy={formPending}
            role='region'
            ref={scrollRef}
            className='min-h-0 min-w-0 flex-1 overflow-y-auto p-(--density-section-padding) [overflow-anchor:none] @max-3xl/settings:[&_[data-slot=button]]:min-h-10 @max-3xl/settings:[&_[data-slot=input-group]]:h-10 @max-3xl/settings:[&_[data-slot=select-trigger]]:min-h-10 @max-3xl/settings:[&_[data-slot=tabs-tab]]:min-h-10 @max-3xl/settings:[&_input]:h-10 @max-3xl/settings:[&_input]:text-base'
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
            <SettingsScrollerContext value={scrollRef}>
              <fieldset className='min-w-0' inert={pending}>
                {project ? <ProjectSection project={project} /> : null}
                {project ? null : shown.length === 0 ? (
                  <StatusMessage>
                    {emptySettingsMessage(shownQuery, selectedCategory)}
                  </StatusMessage>
                ) : (
                  mountedCategories(shown, rowBudget).map(({ category, ids, limit }) => (
                    <CategorySection
                      category={category}
                      ids={ids}
                      key={category}
                      limit={limit}
                      showPush={showPush}
                      snapshot={projection}
                    />
                  ))
                )}
              </fieldset>
            </SettingsScrollerContext>
          </div>
        )}
      </ToolPane>
    </SettingsDisplayProvider>
  )
}

/** Rows that fill a tall window. */
const FIRST_SCREEN_ROWS = 6
const ROWS_PER_PASS = 8

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
function shownCount(shown: FormCategories) {
  return shown.reduce((total, [, ids]) => total + ids.length, 0)
}
