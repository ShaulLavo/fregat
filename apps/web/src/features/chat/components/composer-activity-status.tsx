import { WarningCircleIcon } from '@phosphor-icons/react'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { cn } from '@workspace/ui/lib/utils'
import type { ChatSession } from '@workspace/client-core/chat/types'

import { ComposerActivePlan } from '@/features/chat/components/composer-active-plan'
import { usePendingRequests } from '@/features/chat/hooks/use-pending-requests'
import type { ComposerConnection } from '@/features/chat/utils/composer-connection'
import {
  composerPendingLabel,
  type ComposerPendingAction,
} from '@/features/chat/utils/composer-state'
import { chatActiveWorkLogPlan, chatWorkLogEntries } from '@/features/chat/utils/work-log'

export function ComposerActivityStatus({
  connection,
  pendingAction,
  session,
}: {
  connection: ComposerConnection
  pendingAction: ComposerPendingAction
  session: ChatSession
}) {
  const { pendingApprovals, pendingUserInputs } = usePendingRequests()
  const entries = chatWorkLogEntries({ activities: session.activities })
  const pendingLabel = composerPendingLabel(pendingAction)
  const waiting = pendingApprovals.length > 0 || pendingUserInputs.length > 0
  const waitingLabel = waiting ? 'Waiting for your response' : null
  const label = connection.kind === 'live' ? (pendingLabel ?? waitingLabel) : connection.label
  const activeTurn =
    session.latestTurn?.state === 'running' && session.latestTurn.completedAt === null
  const plan = activeTurn ? chatActiveWorkLogPlan(entries, session.latestTurn?.turnId) : null
  if (!label && !plan) return null

  const active =
    connection.kind === 'syncing' ||
    connection.kind === 'reconnecting' ||
    (connection.kind === 'live' && pendingAction !== null)
  const disconnected = connection.kind === 'disconnected'

  return (
    <div className='compact:px-2 shrink-0 px-3 pt-2' data-composer-activity>
      <div className='border-border/60 bg-card mx-auto max-w-3xl overflow-hidden rounded-lg border'>
        {label ? (
          <div className='flex min-w-0 items-center gap-2 px-2 py-1.5'>
            {active ? (
              <OrbitLoader aria-hidden='true' className='text-muted-foreground size-3.5 shrink-0' />
            ) : null}
            {disconnected || waiting ? (
              <WarningCircleIcon aria-hidden='true' className='text-warning size-3.5 shrink-0' />
            ) : null}
            <span
              className={cn(
                'text-muted-foreground min-w-0 flex-1 truncate text-xs',
                disconnected && 'text-warning',
              )}
              role='status'
              title={label}
            >
              {label}
            </span>
          </div>
        ) : null}
        {connection.kind !== 'live' && connection.detail ? (
          <p className='text-muted-foreground px-2 pb-2 text-[11px]'>{connection.detail}</p>
        ) : null}
        {plan ? <ComposerActivePlan plan={plan} separated={label !== null} /> : null}
      </div>
    </div>
  )
}
