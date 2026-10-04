import { readSettingsMirror } from '@/lib/settings-boot-mirror'

export function inactiveAnalysisEntryLimitFromSettings(): number {
  return readSettingsMirror()['editor.inactiveAnalysisEntryLimit']
}
