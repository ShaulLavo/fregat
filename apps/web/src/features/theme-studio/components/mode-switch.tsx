import type { ColorMode } from '@workspace/contracts'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'

/** Which half the app shows while the studio is open; it writes nothing. */
export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: ColorMode
  onChange: (mode: ColorMode) => void
}) {
  return (
    <Tabs value={mode} onValueChange={(next: ColorMode) => onChange(next)}>
      <TabsList aria-label='Light or dark' variant='segmented'>
        <TabsTab value='light'>Light</TabsTab>
        <TabsTab value='dark'>Dark</TabsTab>
      </TabsList>
    </Tabs>
  )
}
