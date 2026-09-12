import { readSettingsMirror } from '@/features/settings/utils/boot-mirror'

/**
 * The retention budget, read at call time so a change applies to the next project
 * switch or tab close rather than to the next reload.
 *
 * Callers pass this as a function rather than a value, because `apply-actions`
 * must not read settings itself: that would be a cross-feature import and a
 * `localStorage` parse plus a valibot pass on every tab close.
 */
export function retainedTextBudgetFromSettings() {
  return readSettingsMirror()['editor.retainedTextBudget']
}
