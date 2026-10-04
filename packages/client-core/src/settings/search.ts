import { SETTING_ROW_IDS, settingRowIds } from '@workspace/contracts/settings/presentation'
import { presentSetting } from '@workspace/contracts/settings/documentation'
import { type SettingId } from '@workspace/contracts'

import { settingRowTitle } from './humanize'

// A row also matches the keys it owns, so searching models.order finds the Models row.
export function matchingSettingIds(query: string, ids: readonly SettingId[] = SETTING_ROW_IDS) {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...ids]

  return ids
    .map((id) => ({ id, score: scoreRow(id, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .map((entry) => entry.id)
}

function scoreRow(id: SettingId, needle: string): number {
  const scores = settingRowIds(id).map((key) => scoreSetting(key, needle))

  return Math.max(...scores)
}

function scoreSetting(id: SettingId, needle: string): number {
  const descriptor = presentSetting(id)
  if (id.toLowerCase().includes(needle)) return 3
  if (settingRowTitle(id).toLowerCase().includes(needle)) return 3
  if (descriptor.category.toLowerCase().includes(needle)) return 2
  if (descriptor.keywords?.some((keyword) => keyword.toLowerCase().includes(needle))) return 2
  if (descriptor.description.toLowerCase().includes(needle)) return 1

  return 0
}
