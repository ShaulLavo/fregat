import { settingDependencyNote, settingRowTitle } from '@workspace/client-core/settings/humanize'
import {
  descriptorFor,
  layerAllowsScope,
  type SettingId,
  type SettingsWriteTarget,
} from '@workspace/contracts'

import { settingDetails, type SettingsDisplaySnapshot } from '@/settings/utils/rows'
import type { Theme } from '@/theme/utils/theme'
import { settingLayerLabel } from '@/settings/utils/diagnostics'

type DetailsProps = {
  id: SettingId
  snapshot: SettingsDisplaySnapshot
  theme: Theme
  focused: boolean
  target: SettingsWriteTarget
}

export function Details({ id, snapshot, theme, focused, target }: DetailsProps) {
  return (
    <scrollbox
      id='settings-details'
      flexGrow={1}
      minHeight={3}
      minWidth={0}
      focused={focused}
      padding={1}
    >
      <box flexDirection='column' gap={1}>
        <text fg={theme.primary}>
          <strong>{settingRowTitle(id)}</strong>
        </text>
        <text fg={theme.mutedForeground}>{descriptorFor(id).description}</text>
        {settingDetails(id, snapshot).map((entry) => (
          <box key={entry.id} flexDirection='column' gap={1}>
            <text fg={theme.info}>{entry.id}</text>
            <text fg={theme.mutedForeground}>{entry.scope} scope</text>
            {!layerAllowsScope(target, descriptorFor(entry.id).scope) && (
              <text fg={theme.warning}>This setting can only be changed in user settings.</text>
            )}
            {snapshot.layers
              .filter((layer) => entry.id in layer.raw)
              .map((layer) => (
                <text key={layer.id} fg={theme.info}>
                  {settingLayerLabel(entry.id, layer, snapshot.diagnostics)}
                  {layer.id === 'workspace' && entry.scope === 'window'
                    ? ' · this workspace changes application behavior'
                    : ''}
                </text>
              ))}
            {descriptorFor(entry.id).requiresRestart && (
              <text fg={theme.warning}>Requires restart</text>
            )}
            {descriptorFor(entry.id).readOnlyReason && (
              <text fg={theme.warning}>{descriptorFor(entry.id).readOnlyReason}</text>
            )}
            {settingDependencyNote(entry.id, snapshot.values) && (
              <text fg={theme.mutedForeground}>
                {settingDependencyNote(entry.id, snapshot.values)}
              </text>
            )}
            <text fg={theme.foreground}>Effective value: {entry.value}</text>
          </box>
        ))}
      </box>
    </scrollbox>
  )
}
