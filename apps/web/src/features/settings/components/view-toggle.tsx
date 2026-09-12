import { CodeIcon, SlidersHorizontalIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

import { selectSettingsView, useSettingsView } from '../state/view-store'

/**
 * Switches the settings tab between the form and the document it edits.
 *
 * One tab with two views rather than two tabs: they are the same document, and a
 * second tab would let the two drift on screen — the form showing values the text
 * beside it no longer says, with no indication which one the file agrees with.
 *
 * Icons only, in the tab's own action strip rather than beside the scope tabs:
 * the scope picks which file, this picks how to look at it, and putting them on
 * one row read as four peers.
 */
export function ViewToggle() {
  const view = useSettingsView()

  return (
    <div className='flex items-center gap-0.5'>
      <ViewButton
        active={view === 'form'}
        icon={<SlidersHorizontalIcon aria-hidden />}
        label='Settings'
        onSelect={() => selectSettingsView('form')}
      />
      <ViewButton
        active={view === 'json'}
        icon={<CodeIcon aria-hidden />}
        label='settings.json'
        onSelect={() => selectSettingsView('json')}
      />
    </div>
  )
}

function ViewButton({
  active,
  icon,
  label,
  onSelect,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onSelect: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={active}
            className='text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground'
            onClick={onSelect}
            size='icon-sm'
            variant='ghost'
          >
            {icon}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
