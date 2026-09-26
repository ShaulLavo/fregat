import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import type { SettingId } from '@workspace/contracts'
import { settingOptionTitle, settingRowTitle } from '@workspace/client-core/settings/humanize'

/** A short enum shown as a segmented control, every option in view. */
export function SegmentedWidget({
  disabled,
  id,
  onChange,
  options,
  value,
}: {
  disabled?: boolean
  id: SettingId
  onChange: (next: string) => void
  options: readonly string[]
  value: string
}) {
  return (
    <Tabs
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next)
      }}
      value={value}
    >
      <TabsList aria-label={settingRowTitle(id)} id={id} variant='segmented'>
        {options.map((option) => (
          <TabsTab disabled={disabled} key={option} value={option}>
            {settingOptionTitle(id, option)}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  )
}
