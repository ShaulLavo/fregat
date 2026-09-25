import { useQuery } from '@tanstack/react-query'

import { modelPreferenceRows } from '@workspace/client-core/chat/providers/preferences'
import { providerModelOptions } from '@workspace/client-core/chat/providers/models'
import { providerListQueryOptions } from '@/features/chat/utils/provider-query'

import { useSettingValue } from '@/hooks/use-setting-value'
import { EmptyRow } from './empty-row'
import { ModelLoading } from './model-loading'
import { ModelRow } from './model-row'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'

/**
 * The model list, as the single control over both `models.hidden` and `models.order`.
 *
 * One list, two keys, one row on the page. Hiding and ranking are the same
 * decision taken about the same model, and rendering them as two settings meant
 * printing the whole catalogue twice and asking the user to match a switch in
 * the first copy to a pair of arrows in the second.
 *
 * The catalogue is read *unfiltered* — no preferences are passed to
 * `providerModelOptions`, whose job in the picker is to subtract the hidden
 * models. Subtracting them here would mean the switch that hides a model also
 * removes the row holding it, leaving no way to bring it back from the one
 * screen built to do that. `modelPreferenceRows` applies `hidden` as a flag
 * instead, which is what this screen exists to toggle.
 */
export function ModelSection() {
  const { data, isPending } = useQuery(providerListQueryOptions(), useSettingsOwner())
  const hidden = useSettingValue('models.hidden')
  const order = useSettingValue('models.order')
  const rows = modelPreferenceRows(providerModelOptions(data?.providers), { hidden, order })

  if (isPending) return <ModelLoading />
  if (rows.length === 0) return <EmptyRow>No models are available yet.</EmptyRow>

  // A move is one place in *this* sequence, so the rows are what it is computed
  // against — the stored order is sparse and cannot describe the screen.
  const displayed = rows.map((row) => row.ref)

  return (
    <div className='bg-muted flex max-h-64 w-96 max-w-full min-w-0 flex-col overflow-y-auto rounded-lg @max-3xl/settings:w-full'>
      {rows.map((row, index) => (
        <ModelRow
          canMoveDown={index < rows.length - 1}
          canMoveUp={index > 0}
          displayed={displayed}
          key={row.key}
          row={row}
        />
      ))}
    </div>
  )
}
