import type { SettingId } from '@workspace/contracts'

import { ImportSection } from '@/features/settings/components/import-section'
import { McpSection } from '@/features/settings/components/mcp-section'
import { PairingSection } from '@/features/settings/components/pairing-section'
import { PushSection } from '@/features/settings/components/push-section'
import { SettingRow } from '@/features/settings/components/setting-row'
import { UsageSection } from '@/features/settings/components/usage-section'
import type { SettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { isUnderParent } from '@/features/settings/utils/form-categories'
import { MCP_CATEGORY } from '@/features/settings/utils/mcp'

/**
 * One category of the settings form. `limit` caps the rows mounted so far; the page raises it a
 * pass at a time, and a section whose props did not move keeps its rows without rendering them.
 */
export function CategorySection({
  category,
  ids,
  limit,
  showPush,
  snapshot,
}: {
  category: string
  ids: readonly SettingId[]
  limit: number
  showPush: boolean
  snapshot: SettingsProjection
}) {
  return (
    <section className='mb-6'>
      <h2 className='text-foreground mb-1 text-sm font-semibold'>{category}</h2>
      {category === 'Usage' ? <UsageSection /> : null}
      {category === MCP_CATEGORY ? <McpSection /> : null}
      {category === 'Machines' ? <PairingSection /> : null}
      {ids.includes('chat.keepImportedSessionsUpdated') ? <ImportSection /> : null}
      {category === 'Chat' && showPush ? <PushSection snapshot={snapshot} /> : null}
      {ids.slice(0, limit).map((id, index) => (
        <SettingRow id={id} key={id} snapshot={snapshot} underParent={isUnderParent(ids, index)} />
      ))}
    </section>
  )
}
