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
    <div className='border-border compact:px-2 compact:py-1.5 flex items-center gap-2 border-b px-3 py-2 last:border-b-0'>
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='text-foreground truncate text-sm'>{row.label}</span>
        <span className='text-muted-foreground truncate text-xs'>{row.providerLabel}</span>
      </div>

      {/* Buttons rather than drag: the list scrolls inside a settings row inside
          a scrolling page, and a drag that has to auto-scroll two nested
          containers is worse than two clicks — especially for a list where
          moving one model to the top is the whole use case. */}
      <div className='flex items-center'>
        <Button
          aria-label={`Move ${row.label} up`}
          disabled={!canMoveUp}
          onClick={() => moveModel(row.ref, -1, displayed)}
          size='icon-sm'
          variant='ghost'
        >
          <CaretUpIcon />
        </Button>
        <Button
          aria-label={`Move ${row.label} down`}
          disabled={!canMoveDown}
          onClick={() => moveModel(row.ref, 1, displayed)}
          size='icon-sm'
          variant='ghost'
        >
          <CaretDownIcon />
        </Button>
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
