import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ChatCircleIcon, XIcon } from '@phosphor-icons/react'
import {
  diffRowAtEvent,
  type DiffFile,
  type DiffRegionStore,
  type DiffRenderRow,
  type DiffRowHit,
} from '@singapore-editor/diff'
import { Button } from '@workspace/ui/components/button'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { useAttachToComposer } from '@/features/chat/hooks/use-attach-to-composer'
import {
  diffLineAddress,
  diffLineAddressLabel,
  diffLineSelectionText,
  diffRowsForAddress,
  selectedDiffRows,
  stackedDiffRows,
  type DiffLineAddress,
} from '../utils/diff-line-selection'

/**
 * Turns a line range dragged out in the diff into something the agent can act
 * on, and hands it to the composer.
 *
 * Where a press landed is the diff plugin's answer, not this layer's: it names
 * the pane, the rows that pane is showing and the row under the pointer.
 */
export function DiffLineCommentAction({
  file,
  hostRef,
  regions,
}: {
  file: DiffFile
  hostRef: RefObject<HTMLElement | null>
  regions: DiffRegionStore
}) {
  const { attachText } = useAttachToComposer()
  const [address, setAddress] = useState<DiffLineAddress | null>(null)
  // Not state: re-rendering mid-drag on the anchor would only throw the drag away.
  const anchor = useRef<DiffRowHit | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return

      setAddress(null)
      anchor.current = diffRowAtEvent(event)
    }

    // On the document because a drag that runs past the last row releases
    // outside the pane, and that is the selection most worth capturing.
    const onMouseUp = (event: MouseEvent) => {
      const start = anchor.current
      anchor.current = null
      if (!start) return

      const head = diffRowAtEvent(event)
      const headRow = head?.side === start.side ? head.rowIndex : start.rowIndex
      const dragged = selectedDiffRows(start.rows, start.rowIndex, headRow)
      const stackedRows = stackedDiffRows(file, regions.getExpandedRegions())
      setAddress(canonicalAddress(diffLineAddress(dragged), stackedRows))
    }

    host.addEventListener('mousedown', onMouseDown, true)
    host.ownerDocument.addEventListener('mouseup', onMouseUp)

    return () => {
      host.removeEventListener('mousedown', onMouseDown, true)
      host.ownerDocument.removeEventListener('mouseup', onMouseUp)
    }
  }, [file, hostRef, regions])

  if (!address) return null

  const ask = () => {
    // Resolved against the stacked projection so the agent gets both sides of
    // the change even when the range was dragged out in one split pane.
    const rows = diffRowsForAddress(stackedDiffRows(file, regions.getExpandedRegions()), address)
    if (rows.length === 0) return
    if (!attachText('git-diff', diffLineSelectionText(file.path, address, rows))) return

    setAddress(null)
  }

  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-(--density-section-padding)'>
      <div className='bg-popover-solid ring-foreground/10 pointer-events-auto flex items-center gap-1 rounded-lg p-(--density-gap-tight) shadow-md ring-1'>
        <span className='text-muted-foreground px-(--density-control-padding-x-tight) text-xs tabular-nums'>
          {diffLineAddressLabel(address)}
        </span>
        <Button onClick={ask} size='sm' variant='ghost'>
          <ChatCircleIcon data-icon='inline-start' />
          Ask the agent about these lines
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label='Dismiss line selection'
                onClick={() => setAddress(null)}
                size='icon-sm'
                variant='ghost'
              >
                <XIcon />
              </Button>
            }
          />
          <TooltipContent>{'Dismiss line selection'}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * Settles a drag on the address the stacked projection would give it, so the
 * range on the bar is the range that gets sent — a drag through one split pane
 * names only that pane's side until it is resolved against both.
 */
function canonicalAddress(
  address: DiffLineAddress | null,
  stackedRows: readonly DiffRenderRow[],
): DiffLineAddress | null {
  if (!address) return null

  return diffLineAddress(diffRowsForAddress(stackedRows, address))
}
