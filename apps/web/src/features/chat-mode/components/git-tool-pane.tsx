import type { ReactNode } from 'react'
import { ToolPane as PaneShell } from '@workspace/ui/patterns/tool-pane'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { checkpointAvailability } from '@/lib/checkpoint-availability'
import { TurnFiles } from '@/features/chat-mode/components/turn-files'
import { CheckpointLoading } from '@/features/chat-mode/components/checkpoint-loading'
import { CheckpointState } from '@/features/chat-mode/components/checkpoint-state'
import type { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'
import { Panel as GitPanel } from '@/features/git/components/panel'

type SessionDiffScopeState = ReturnType<typeof useSessionDiffScope>

/**
 * Mounts the header itself rather than reusing `GitChangesPanel`, which carries
 * its own: the scope bar has to sit between the header and the panel body, and
 * that panel belongs to the workbench sidebar too.
 */
export function GitToolPane({
  diffScope,
  header,
  rootPath,
}: {
  readonly diffScope: SessionDiffScopeState
  readonly header: ReactNode
  /** The session's checkout. */
  readonly rootPath: string
}) {
  const { latestTurnId, scope, selectTurnScope, selectWorkingTreeScope } = diffScope

  return (
    <PaneShell
      className='h-full min-w-0 overflow-hidden'
      scroll={false}
      header={header}
      subheader={
        <PaneBar>
          <Tabs
            value={scope.kind}
            onValueChange={(next: typeof scope.kind) => {
              if (next === 'working-tree') return selectWorkingTreeScope()
              if (latestTurnId) selectTurnScope(latestTurnId)
            }}
          >
            <TabsList aria-label='Diff scope' variant='segmented'>
              <TabsTab value='working-tree'>Working tree</TabsTab>
              {/* A session with no checkpoint has no turn to show; an inert tab says so. */}
              <TabsTab
                disabled={!latestTurnId}
                value='turn'
                // Clicking the selected tab changes no value; from an older turn it returns to the latest.
                onClick={() => {
                  if (scope.kind === 'turn' && latestTurnId) selectTurnScope(latestTurnId)
                }}
              >
                Turn
              </TabsTab>
            </TabsList>
          </Tabs>
        </PaneBar>
      }
    >
      {scope.kind === 'turn' ? (
        turnScopeBody(rootPath, diffScope)
      ) : (
        <GitPanel rootPath={filesystemPath(rootPath)} />
      )}
    </PaneShell>
  )
}

function turnScopeBody(rootPath: string, { openTurnFile, turnSummary }: SessionDiffScopeState) {
  const availability = checkpointAvailability(turnSummary)
  if (availability.kind === 'pending') return <CheckpointLoading />
  if (availability.kind !== 'available') return <CheckpointState availability={availability} />

  return <TurnFiles rootPath={rootPath} summary={availability.summary} onOpenFile={openTurnFile} />
}
