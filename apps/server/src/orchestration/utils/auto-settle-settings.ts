import type { SettingsStore } from '../../settings/store'
import type { AutoSettleRules } from './auto-settlement'

/** Each field of a project override wins over the machine default on its own. */
export function autoSettleRules(
  settings: Pick<SettingsStore, 'snapshot'>,
  projectId: string,
): AutoSettleRules {
  const values = settings.snapshot().values
  const override = values['chat.projectAutoSettle'][projectId]
  return {
    afterDays: override?.afterDays ?? values['chat.autoSettleAfterDays'],
    onMerge: override?.onMerge ?? values['chat.autoSettleOnMerge'],
  }
}
