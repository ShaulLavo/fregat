import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Switch } from '@workspace/ui/components/switch'

import type { ModelRef } from '@workspace/contracts'

import type { ModelPreferenceRow } from '@workspace/client-core/chat/providers/preferences'

import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'

export function ModelRow({
  canMoveDown,
  canMoveUp,
  displayed,
  row,
}: {
  canMoveDown: boolean
  canMoveUp: boolean
  /** The list as rendered, which is what a move is relative to. */
  displayed: readonly ModelRef[]
  row: ModelPreferenceRow
}) {
  const { moveModel, setModelHidden } = useSettingsActions()

  return (
    <div
      className='flex items-center gap-2 px-(--density-control-padding-x) py-(--density-section-gap)'
      title={`${row.label} · ${row.providerLabel} (${row.key})`}
    >
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='text-foreground truncate text-sm'>{row.label}</span>
        <span className='text-muted-foreground truncate text-xs'>{row.providerLabel}</span>
      </div>

      {/* Buttons rather than drag: the list scrolls inside a settings row inside
          a scrolling page, and a drag that has to auto-scroll two nested
          containers is worse than two clicks — especially for a list where
          moving one model to the top is the whole use case. */}
      <div className='flex items-center'>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={`Move ${row.label} up`}
                disabled={!canMoveUp}
                focusableWhenDisabled
                onClick={() => moveModel(row.ref, -1, displayed)}
                size='icon-sm'
                variant='ghost'
              >
                <CaretUpIcon />
              </Button>
            }
          />
          <TooltipContent>{`Move ${row.label} up`}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={`Move ${row.label} down`}
                disabled={!canMoveDown}
                focusableWhenDisabled
                onClick={() => moveModel(row.ref, 1, displayed)}
                size='icon-sm'
                variant='ghost'
              >
                <CaretDownIcon />
              </Button>
            }
          />
          <TooltipContent>{`Move ${row.label} down`}</TooltipContent>
        </Tooltip>
      </div>

      {/* On means visible, always. The stored key is a denylist, but a switch
          whose ON state takes a model away from you is not a switch anyone reads
          correctly — the polarity belongs to the user's sentence, not the
          file's. */}
      <Switch
        aria-label={`Show ${row.label}`}
        checked={!row.hidden}
        onCheckedChange={(checked) => setModelHidden(row.ref, !checked)}
      />
    </div>
  )
}
