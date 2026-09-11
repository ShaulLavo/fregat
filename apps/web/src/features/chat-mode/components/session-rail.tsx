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
import { useState, type KeyboardEvent } from 'react'

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
import { useRailOrderStore } from '@/features/chat-mode/state/rail-order-store'
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
import { Input } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'

const RAIL_DND_MODIFIERS = [restrictToVerticalAxis]

export function SessionRail() {
  const { activeSession, addProject, project, ready, transport } = useChatModeSession()
  const { reorderProject } = useChatRailOrder()
  const sensors = useRailDragSensors()
  const projectOrderKeys = useRailOrderStore((state) => state.projectOrderKeys)
  const sessionOrderKeys = useRailOrderStore((state) => state.sessionOrderKeys)
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
  const model = sessionRailModel({
    activeProjectId: project?.id ?? null,
    activeSessionKey: activeSession.sessionId
      ? scopedSessionKey({
          environmentId: transport.environmentId,
          sessionId: activeSession.sessionId,
        })
      : null,
    collapsedProjectIds,
    orderOverrides: { projectOrderKeys, sessionOrderKeys },
    environments,
    query,
    scope,
    machineFilter,
    searchMatches,
    seenBySessionKey,
    view,
  })

  function toggleView() {
    void navigation.setRail(view === 'archived' ? 'active' : 'archived')
  }

  function handleProjectDragStart(event: DragStartEvent) {
    setDraggingProjectId(String(event.active.id))
  }

  function handleProjectDragEnd(event: DragEndEvent) {
    setDraggingProjectId(null)
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
      <div className='compact:pt-1.5 flex shrink-0 items-center gap-1 px-2 pt-2'>
        <Button
          className='compact:h-7 compact:gap-1.5 compact:px-1.5 h-8 min-w-0 flex-1 justify-start gap-2 rounded-md px-2 text-[13px]'
          disabled={!ready && !scope}
          size='sm'
          type='button'
          variant='ghost'
          onClick={startScopedSessionDraft}
        >
          <PlusIcon className='size-4 shrink-0' weight='bold' />
          <span className='truncate'>New session</span>
        </Button>
        <Button
          aria-label='Manage worktrees'
          title='Manage worktrees'
          size='icon-sm'
          variant='ghost'
          disabled={!model.projects.length}
          onClick={() => {
            const target =
              model.projects.find((item) => item.id === project?.id) ?? model.projects[0]
            if (target) useWorktreeManagerStore.getState().openManager(target.ref)
          }}
        >
          <GitForkIcon className='size-4' />
        </Button>
        <Button
          aria-label='Add project'
          className='text-muted-foreground hover:text-foreground compact:size-7 size-8 shrink-0 rounded-md'
          size='icon-sm'
          title='Add project'
          type='button'
          variant='ghost'
          onClick={addProject}
        >
          <FolderPlusIcon className='size-4' />
        </Button>
      </div>
      <div className='compact:pt-0.5 flex shrink-0 items-center gap-1 px-2 pt-1'>
        <SessionScopeMenu
          projects={model.projects}
          scope={scope}
          scopeTitle={model.scopeTitle}
          onSelectScope={setScope}
        />
        <SessionMachineMenu />
        <Button
          aria-label='Archived sessions'
          aria-pressed={view === 'archived'}
          className={cn(
            'text-muted-foreground hover:text-foreground ml-auto size-7 shrink-0 rounded-md compact:size-6',
            view === 'archived' && 'bg-accent text-accent-foreground',
          )}
          size='icon-sm'
          title={`Archived sessions (${model.archivedCount})`}
          type='button'
          variant='ghost'
          onClick={toggleView}
        >
          <ArchiveIcon className='size-3.5' />
        </Button>
        <span className='text-muted-foreground/60 shrink-0 text-[11px] tabular-nums'>
          {model.scopedCount}
        </span>
      </div>
      <div className='compact:py-1.5 relative shrink-0 px-2 py-2'>
        <MagnifyingGlassIcon className='text-muted-foreground/60 pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2' />
        <Input
          aria-label='Search sessions'
          // The native search affordances duplicate our own clear button.
          className='compact:h-6 h-7 rounded-md pr-7 pl-7 text-[12px] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden'
          placeholder='Search sessions'
          type='search'
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <Button
            aria-label='Clear search'
            className='text-muted-foreground hover:text-foreground absolute top-1/2 right-3 size-5 -translate-y-1/2 rounded-sm'
            size='icon-sm'
            type='button'
            variant='ghost'
            onClick={() => setQuery('')}
          >
            <XIcon className='size-3' />
          </Button>
        ) : null}
      </div>
      <MachineConnectionRows />
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='compact:gap-1 compact:pb-2 flex flex-col gap-2 px-1 pb-3'>
          <DndContext
            collisionDetection={closestCenter}
            modifiers={RAIL_DND_MODIFIERS}
            sensors={sensors}
            onDragCancel={() => setDraggingProjectId(null)}
            onDragEnd={handleProjectDragEnd}
            onDragStart={handleProjectDragStart}
          >
            <SortableContext
              items={model.groups.map((group) => group.key)}
              strategy={verticalListSortingStrategy}
            >
              {model.sections.map((section) => (
                <section key={section.state} aria-label={section.title}>
                  <h2 className='text-muted-foreground px-2 py-1 text-[11px] font-medium'>
                    {section.title}
                  </h2>
                  {section.groups.map((group) => (
                    <SessionGroup
                      activeSessionKey={
                        activeSession.sessionId
                          ? scopedSessionKey({
                              environmentId: transport.environmentId,
                              sessionId: activeSession.sessionId,
                            })
                          : null
                      }
                      group={group}
                      key={group.key}
                    />
                  ))}
                </section>
              ))}
            </SortableContext>
            {/* Only the header travels. Lifting the whole band — header plus every
                session row — made a project drag a page-sized slab. */}
            <DragOverlay dropAnimation={null}>
              {draggingGroup ? (
                <div className='bg-popover border-border pointer-events-none rounded-md border shadow-lg'>
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
      {isSessionBulkSelection(markedSessionIds) ? <SessionBulkBar /> : null}
    </aside>
  )
}
