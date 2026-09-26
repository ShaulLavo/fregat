import { CodeIcon, SlidersHorizontalIcon } from '@phosphor-icons/react'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

import { selectSettingsScope, settingsScope } from '../state/scope-store'
import { selectSettingsView, useSettingsView, type SettingsView } from '../state/view-store'

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
    <Tabs value={view} onValueChange={(next: SettingsView) => selectView(next)}>
      <TabsList aria-label='Settings view' variant='segmented'>
        <ViewTab icon={<SlidersHorizontalIcon aria-hidden />} label='Settings' value='form' />
        <ViewTab icon={<CodeIcon aria-hidden />} label='settings.json' value='json' />
      </TabsList>
    </Tabs>
  )
}

// The defaults tab has no form, so asking for one means leaving that tab.
function selectView(view: SettingsView) {
  if (view === 'form' && settingsScope() === 'default') selectSettingsScope('user')
  selectSettingsView(view)
}

function ViewTab({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: SettingsView
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <TabsTab
            aria-label={label}
            className='w-(--density-control-height-sm) px-0'
            value={value}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
