import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ArrowCounterClockwiseIcon, ProhibitIcon } from '@phosphor-icons/react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'

import type { CommandKeyBindingRow } from '@/keymap/active-bindings'
import { platformCommandSpec } from '@/keymap/command-registry'
import { useCommand } from '@/keymap/hooks/use-command'

import { ChordRecorder } from '@/features/settings/components/widgets/chord-recorder'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'

export function KeybindingRow({
  binding,
  claimedFrom,
}: {
  binding: CommandKeyBindingRow
  /** How many other commands lost this chord to this one. */
  claimedFrom: number
}) {
  const { bindings } = useCommand()
  const { resetKeybinding, setKeybinding } = useSettingsActions()
  // A command the registry carries no spec for falls back to its id, and
  // repeating the id underneath would print the same string twice.
  const spec = platformCommandSpec(binding.command)
  const title = spec?.title ?? binding.command
  const shadowed = binding.shadowedBy ? `; shadowed by ${binding.shadowedBy}` : ''
  const rowTitle = `${title} (${binding.command})${shadowed}`

  return (
    <div
      className='flex items-center gap-2 px-(--density-control-padding-x) py-(--density-section-gap) @max-3xl/settings:grid @max-3xl/settings:grid-cols-[minmax(0,1fr)_auto_auto]'
      title={rowTitle}
    >
      <div className='flex min-w-0 flex-1 flex-col @max-3xl/settings:col-span-full'>
        <span className='text-foreground truncate text-sm'>{title}</span>
        {spec ? (
          <span className='text-muted-foreground truncate text-xs'>{binding.command}</span>
        ) : null}
        {binding.shadowedBy ? (
          // The chord is still shown beside this: together they read as "this
          // shortcut exists on paper and another command answers it".
          <span className='text-warning truncate text-xs'>
            Shadowed by {platformCommandSpec(binding.shadowedBy)?.title ?? binding.shadowedBy}
          </span>
        ) : null}
      </div>

      {binding.source === 'user' ? (
        <Badge className='@max-3xl/settings:col-span-full' variant='secondary'>
          Custom
        </Badge>
      ) : null}

      <ChordRecorder
        bindings={bindings}
        conflictCount={claimedFrom}
        id={binding.command}
        onChange={(next) => setKeybinding(binding.command, next)}
        value={binding.keys ?? ''}
      />

      {/* Unbind and Reset are different documents: `null` is "this command has
          no shortcut", an absent key is "use the default". One button cannot
          say both. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={`Unbind ${title}`}
              disabled={binding.keys === null}
              focusableWhenDisabled
              onClick={() => setKeybinding(binding.command, null)}
              size='icon-sm'
              variant='ghost'
            >
              <ProhibitIcon />
            </Button>
          }
        />
        <TooltipContent>{`Unbind ${title}`}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={`Reset ${title}`}
              disabled={binding.source !== 'user'}
              focusableWhenDisabled
              onClick={() => resetKeybinding(binding.command)}
              size='icon-sm'
              variant='ghost'
            >
              <ArrowCounterClockwiseIcon />
            </Button>
          }
        />
        <TooltipContent>{`Reset ${title}`}</TooltipContent>
      </Tooltip>
    </div>
  )
}
