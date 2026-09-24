import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import type { OrchestrationProposedPlan } from '@workspace/contracts'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { cn } from '@workspace/ui/lib/utils'
import { CaretDownIcon, CaretUpIcon, DotsThreeIcon } from '@phosphor-icons/react'
import { useState } from 'react'

import { copyTextToClipboard } from '@/lib/clipboard'
import { formatChatTimestamp } from '@/features/chat/utils/formatters'
import {
  canCollapseProposedPlan,
  collapsedProposedPlanMarkdown,
  proposedPlanExportFilename,
  proposedPlanExportMarkdown,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from '@workspace/client-core/chat/proposed-plan'
import { AssistantMarkdown } from './assistant-markdown'

export function ProposedPlanCard({ plan }: { plan: OrchestrationProposedPlan }) {
  const [expanded, setExpanded] = useState(false)
  const canCollapse = canCollapseProposedPlan(plan.planMarkdown)
  const markdown =
    canCollapse && !expanded
      ? collapsedProposedPlanMarkdown(plan.planMarkdown)
      : stripDisplayedPlanMarkdown(plan.planMarkdown)
  const title = proposedPlanTitle(plan.planMarkdown)
  const ExpandIcon = expanded ? CaretUpIcon : CaretDownIcon
  // The plan outlives the session it was written in, so the export carries the
  // heading the card strips for display.
  const exportMarkdown = proposedPlanExportMarkdown(plan.planMarkdown)

  return (
    <article className='bg-card/70 rounded-lg p-4 text-sm sm:p-5'>
      <div className='flex min-w-0 flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2' title={title}>
          <Badge variant='secondary'>Plan</Badge>
          {plan.implementedAt ? (
            <Badge className='border-success/40 text-success' variant='outline'>
              Implemented
            </Badge>
          ) : null}
          <p className='text-foreground truncate text-sm font-medium'>{title}</p>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <span className='text-muted-foreground text-2xs text-3xs tabular-nums'>
            {formatChatTimestamp(plan.updatedAt)}
          </span>
          <DropdownMenu>
            <Tooltip>
              <DropdownMenuTrigger
                render={
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label='Plan actions'
                        size='icon-xs'
                        type='button'
                        variant='outline'
                      >
                        <DotsThreeIcon aria-hidden='true' className='size-(--icon-size-sm)' />
                      </Button>
                    }
                  />
                }
              />
              <TooltipContent>{'Plan actions'}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => void copyTextToClipboard(exportMarkdown, 'plan')}>
                Copy to clipboard
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  downloadPlanMarkdown(
                    proposedPlanExportFilename(plan.planMarkdown),
                    exportMarkdown,
                  )
                }
              >
                Download as markdown
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className='mt-4'>
        <div
          className={cn('relative', canCollapse && !expanded && 'max-h-[26rem] overflow-hidden')}
        >
          <AssistantMarkdown className='text-xs leading-5' text={markdown} />
          {canCollapse && !expanded ? (
            <div className='from-card/95 via-card/80 pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t to-transparent' />
          ) : null}
        </div>
        {canCollapse ? (
          <div className='mt-4 flex justify-center'>
            <Button
              size='sm'
              type='button'
              variant='outline'
              onClick={() => setExpanded((value) => !value)}
            >
              <ExpandIcon className='size-(--icon-size-sm)' />
              {expanded ? 'Collapse plan' : 'Expand plan'}
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function downloadPlanMarkdown(filename: string, markdown: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
  link.click()
  URL.revokeObjectURL(link.href)
}
