import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ChatCircleIcon, XIcon } from '@phosphor-icons/react'
import type { DiffFile, DiffRegionStore, DiffRenderRow } from '@singapore-editor/diff'
import { Button } from '@workspace/ui/components/button'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { useAttachToComposer } from '@/features/chat/hooks/use-attach-to-composer'
import {
  diffLineAddress,
  diffLineAddressLabel,
  diffLineSelectionText,
  diffPaneRows,
  diffRowsForAddress,
  selectedDiffRows,
  type DiffLineAddress,
  type DiffPaneSide,
} from '../utils/diff-line-selection'

type RowTarget = {
  readonly rowIndex: number
  readonly side: DiffPaneSide
}

/**
 * Turns a line range dragged out in the diff into something the agent can act
 * on, and hands it to the composer.
 *
 * What is read back from the panes is the one thing they publish: the row index
 * on each mounted row element. Everything after that — which side of the diff a
 * row is on, which lines it is — is derived from the same projection the panes
 * rendered, over the same expansion state, which the diff plugin owns and this
 * only reads.
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
  const anchor = useRef<RowTarget | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const rowsFor = (side: DiffPaneSide) => diffPaneRows(file, side, regions.getExpandedRegions())

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return

      setAddress(null)
      anchor.current = rowTargetAt(event, rowsFor)
    }

    // On the document because a drag that runs past the last row releases
    // outside the pane, and that is the selection most worth capturing.
    const onMouseUp = (event: MouseEvent) => {
      const start = anchor.current
      anchor.current = null
      if (!start) return

      const head = rowTargetAt(event, rowsFor)
      const headRow = head?.side === start.side ? head.rowIndex : start.rowIndex
      const dragged = selectedDiffRows(rowsFor(start.side), start.rowIndex, headRow)
      setAddress(canonicalAddress(diffLineAddress(dragged), rowsFor('stacked')))
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
    const rows = diffRowsForAddress(
      diffPaneRows(file, 'stacked', regions.getExpandedRegions()),
      address,
    )
    if (rows.length === 0) return
    if (!attachText('git-diff', diffLineSelectionText(file.path, address, rows))) return

    setAddress(null)
  }

  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-(--density-section-padding)'>
      <div className='bg-popover-solid border-border pointer-events-auto flex items-center gap-1 rounded-lg border p-(--density-gap-tight) shadow-md'>
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

function rowTargetAt(
  event: MouseEvent,
  rowsFor: (side: DiffPaneSide) => readonly DiffRenderRow[],
): RowTarget | null {
  const target = event.target
  if (!(target instanceof Element)) return null

  const element = target.closest<HTMLElement>('[data-editor-virtual-row]')
  const side = paneSide(element?.closest('.editor-diff-pane'))
  if (!element || !side) return null

  const rowIndex = Number(element.dataset.editorVirtualRow)
  return rowsFor(side)[rowIndex] ? { rowIndex, side } : null
}

function paneSide(pane: Element | null | undefined): DiffPaneSide | null {
  if (!pane) return null
  if (pane.classList.contains('editor-diff-pane-old')) return 'old'
  if (pane.classList.contains('editor-diff-pane-new')) return 'new'
  if (pane.classList.contains('editor-diff-pane-stacked')) return 'stacked'

  return null
}
