import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { forwardActiveRowKey } from '@/lib/list-keyboard'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { SessionListContext } from '@/features/chat-mode/providers/list-context'
import { activateSessionRow } from '@/features/chat-mode/state/session-commands'
import { useNavigation } from '@/hooks/use-navigation'
import { useWorktreeManagerStore } from '@/features/chat-mode/state/worktree-manager-store'
import { scopedSessionKey } from '@workspace/contracts'
import { useRailEnvironments } from '@/features/chat-mode/hooks/use-rail-environments'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  ArchiveIcon,
  FolderPlusIcon,
  GitForkIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useLayoutEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { createStore } from 'zustand/vanilla'

import { SessionRailEmpty } from '@/features/chat-mode/components/session-rail-empty'

import { SessionBulkBar } from '@/features/chat-mode/components/session-bulk-bar'
import { SessionGroup } from '@/features/chat-mode/components/session-group'
import { SessionGroupHeader } from '@/features/chat-mode/components/session-group-header'
import { SessionScopeMenu } from '@/features/chat-mode/components/session-scope-menu'
import { SessionMachineMenu } from '@/features/chat-mode/components/session-machine-menu'
import { MachineConnectionRows } from '@/features/chat-mode/components/machine-connection-rows'
import { useRailDragSensors } from '@/features/chat-mode/hooks/use-rail-drag-sensors'
import { useSessionSearch } from '@/features/chat-mode/hooks/use-session-search'
import { useChatRailOrder } from '@/features/chat-mode/providers/rail-order-context'
import { useChatModeSession } from '@/features/chat-mode/providers/session-context'
import { useRailOrderOverrides } from '@/features/chat-mode/hooks/use-rail-order-overrides'
import {
  clearSessionMultiSelect,
  startScopedSessionDraft,
} from '@/features/chat-mode/state/session-commands'
import {
  isSessionBulkSelection,
  useSessionMultiSelectStore,
} from '@/features/chat-mode/state/session-multi-select-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useSessionReadStore } from '@/features/chat-mode/state/session-read-store'
import { useSessionSearchStore } from '@/features/chat-mode/state/session-search-store'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import { Button } from '@workspace/ui/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@workspace/ui/components/input-group'
import { cn } from '@workspace/ui/lib/utils'

const RAIL_DND_MODIFIERS = [restrictToVerticalAxis]

export function SessionRail() {
  const { activeSession, addProject, project, ready, transport } = useChatModeSession()
  const { reorderProject } = useChatRailOrder()
  const sensors = useRailDragSensors()
  const orderOverrides = useRailOrderOverrides()
  const environments = useRailEnvironments()
  const seenBySessionKey = useSessionReadStore((state) => state.seenBySessionKey)
  const collapsedProjectIds = useSessionRailStore((state) => state.collapsedProjectIds)
  const query = useSessionRailStore((state) => state.query)
  const scope = useSessionRailStore((state) => state.scope)
  const machineFilter = useSessionRailStore((state) => state.machineFilter)
  const view = useSessionRailStore((state) => state.view)
  const setQuery = useSessionRailStore((state) => state.setQuery)
  const setScope = useSessionRailStore((state) => state.setScope)
  const navigation = useNavigation()
  const markedSessionIds = useSessionMultiSelectStore((state) => state.refs)
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null)
  useSessionSearch()
  const searchMatches = useSessionSearchStore((state) => state.matchBySessionKey)
  const searching = useSessionSearchStore((state) => state.searching)
  const activeSessionKey = activeSession.sessionId
    ? scopedSessionKey({
        environmentId: transport.environmentId,
        sessionId: activeSession.sessionId,
      })
    : null
  const activeProjectId = project?.id ?? null
  // Keep model items stable across cursor updates; rebuilding them wakes every row.
  const model = useMemo(
    () =>
      sessionRailModel({
        activeProjectId,
        activeSessionKey,
        collapsedProjectIds,
        orderOverrides,
        environments,
        query,
        scope,
        machineFilter,
        searchMatches,
        seenBySessionKey,
        view,
      }),
    [
      activeProjectId,
      activeSessionKey,
      collapsedProjectIds,
      orderOverrides,
      environments,
      query,
      scope,
      machineFilter,
      searchMatches,
      seenBySessionKey,
      view,
    ],
  )
  const [cursor, setCursor] = useState<{ owner: string | null; id: string } | null>(null)
  const [selection] = useState(() => createStore<string | null>(() => null))
  const visibleSessions = model.groups.flatMap((group) => group.sessions)
  function selectSession(id: string) {
    setCursor({ owner: activeSessionKey, id })
    const session = visibleSessions.find((item) => item.key === id)
    if (session) void activateSessionRow(session, 'open')
  }
  function commitRow(id: string) {
    const group = model.groups.find((item) => item.key === id)
    if (!group) return selectSession(id)
    useSessionRailStore.getState().toggleProjectCollapsed(group.project.id)
  }
  const list = useListbox({
    role: 'listbox',
    items: model.groups.flatMap((group) => [
      { id: group.key, label: group.project.title },
      ...group.sessions.map((session) => ({ id: session.key, label: session.title })),
    ]),
    activeId: cursor?.owner === activeSessionKey ? cursor.id : activeSessionKey,
    onActiveChange: selectSession,
    onCommit: commitRow,
    onActiveKeyDown(event, id) {
      const group = model.groups.find((item) => item.key === id)
      if (group && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        if ((event.key === 'ArrowLeft') !== group.collapsed) commitRow(id)
        return
      }
      if (
        event.key === ' ' ||
        event.key === 'ContextMenu' ||
        (event.shiftKey && event.key === 'F10')
      )
        forwardActiveRowKey(event)
    },
  })

  const focusList = list.focus
  useLayoutEffect(() => selection.setState(list.activeId, true), [list.activeId, selection])
  const listContext = { rowBindings: list.rowBindings, focusList, selection }

  function toggleView() {
    void navigation.setRail(view === 'archived' ? 'active' : 'archived')
  }

  function handleProjectDragStart(event: DragStartEvent) {
    setDraggingProjectId(String(event.active.id))
  }

  function handleProjectDragCancel(event: DragEndEvent) {
    setDraggingProjectId(null)
    if (event.activatorEvent instanceof globalThis.KeyboardEvent) focusList()
  }

  function handleProjectDragEnd(event: DragEndEvent) {
    handleProjectDragCancel(event)
    reorderProject(String(event.active.id), event.over ? String(event.over.id) : null)
  }

  const draggingGroup = model.groups.find((group) => group.key === draggingProjectId) ?? null

  // Escape is the universal "never mind" for a marked set, and the rail is the only
  // place it means that — the app keymap has no business knowing about this list.
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return
    if (markedSessionIds.length === 0) return

    event.preventDefault()
    clearSessionMultiSelect()
  }

  return (
    <aside
      className='bg-card backdrop-material border-border flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r'
      onKeyDown={handleKeyDown}
    >
      <div className='flex shrink-0 items-center gap-1 px-2 pt-(--density-section-gap)'>
        <Button
          className='min-w-0 flex-1 justify-start'
          disabled={!ready && !scope}
          size='sm'
          type='button'
          variant='ghost'
          onClick={startScopedSessionDraft}
        >
          <PlusIcon className='size-(--icon-size) shrink-0' weight='bold' />
          <span className='truncate'>New session</span>
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label='Manage worktrees'
                size='icon-sm'
                variant='ghost'
                disabled={!model.projects.length}
                onClick={() => {
                  const target =
                    model.projects.find((item) => item.id === project?.id) ?? model.projects[0]
                  if (target) useWorktreeManagerStore.getState().openManager(target.ref)
                }}
              >
                <GitForkIcon className='size-(--icon-size)' />
              </Button>
            }
          />{' '}
          <TooltipContent>{'Manage worktrees'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label='Add project'
                className='text-muted-foreground hover:text-foreground shrink-0'
                size='icon-sm'
                type='button'
                variant='ghost'
                onClick={addProject}
              >
                <FolderPlusIcon className='size-(--icon-size)' />
              </Button>
            }
          />{' '}
          <TooltipContent>{'Add project'}</TooltipContent>
        </Tooltip>
      </div>
      <div className='flex shrink-0 items-center gap-1 px-2 pt-(--density-gap-tight)'>
        <SessionScopeMenu
          projects={model.projects}
          scope={scope}
          scopeTitle={model.scopeTitle}
          onSelectScope={setScope}
        />
        <SessionMachineMenu />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label='Archived sessions'
                aria-pressed={view === 'archived'}
                className={cn(
                  'text-muted-foreground hover:text-foreground ml-auto shrink-0',
                  view === 'archived' && 'bg-accent text-accent-foreground',
                )}
                size='icon-sm'
                type='button'
                variant='ghost'
                onClick={toggleView}
              >
                <ArchiveIcon className='size-(--icon-size-sm)' />
              </Button>
            }
          />{' '}
          <TooltipContent>{`Archived sessions (${model.archivedCount})`}</TooltipContent>
        </Tooltip>
        <span className='text-muted-foreground text-2xs shrink-0 tabular-nums'>
          {model.scopedCount}
        </span>
      </div>
      <div className='shrink-0 px-2 py-(--density-section-gap)'>
        <InputGroup className='h-(--density-control-height-sm)'>
          <InputGroupAddon align='inline-start'>
            <MagnifyingGlassIcon aria-hidden='true' className='size-(--icon-size-sm)' />
          </InputGroupAddon>
          <InputGroupInput
            aria-label='Search sessions'
            autoCapitalize='off'
            autoComplete='off'
            autoCorrect='off'
            // The native search affordances duplicate our own clear button.
            className='h-full text-xs [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden'
            placeholder='Search sessions'
            spellCheck={false}
            type='search'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <InputGroupAddon align='inline-end'>
              <InputGroupButton
                aria-label='Clear search'
                className='text-muted-foreground hover:text-foreground'
                size='icon-xs'
                onClick={() => setQuery('')}
              >
                <XIcon className='size-(--icon-size-sm)' />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>
      <MachineConnectionRows />
      <SessionListContext value={listContext}>
        <div
          {...list.containerProps}
          aria-label='Sessions'
          className='focus-ring-inset min-h-0 flex-1 overflow-y-auto'
        >
          <div className='flex flex-col gap-(--density-control-gap) px-1 pb-(--density-section-padding)'>
            <DndContext
              accessibility={{ restoreFocus: false }}
              collisionDetection={closestCenter}
              modifiers={RAIL_DND_MODIFIERS}
              sensors={sensors}
              onDragCancel={handleProjectDragCancel}
              onDragEnd={handleProjectDragEnd}
              onDragStart={handleProjectDragStart}
            >
              <SortableContext
                items={model.groups.map((group) => group.key)}
                strategy={verticalListSortingStrategy}
              >
                {model.sections.map((section) => (
                  <section key={section.state} aria-label={section.title}>
                    <h2 className='text-muted-foreground text-2xs flex h-(--density-control-height-sm) items-center px-(--density-row-padding-x) font-medium tracking-wider uppercase'>
                      {section.title}
                    </h2>
                    {section.groups.map((group) => (
                      <SessionGroup group={group} key={group.key} />
                    ))}
                  </section>
                ))}
              </SortableContext>
              {/* Only the header travels. Lifting the whole band — header plus every
                session row — made a project drag a page-sized slab. */}
              <DragOverlay dropAnimation={null}>
                {draggingGroup ? (
                  <div className='bg-popover border-border pointer-events-none rounded-lg border shadow-md'>
                    <SessionGroupHeader group={draggingGroup} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
            {model.sessions.length === 0 ? (
              <SessionRailEmpty query={query} ready={ready} searching={searching} view={view} />
            ) : null}
          </div>
        </div>
      </SessionListContext>
      {isSessionBulkSelection(markedSessionIds) ? <SessionBulkBar /> : null}
    </aside>
  )
}
