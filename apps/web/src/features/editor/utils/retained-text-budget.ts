import { readSettingBootValue } from '@/lib/settings-boot-mirror'

/**
 * Read at call time, so a change applies at the next switch or close rather than
 * the next reload. Injected as a function to keep `apply-actions` off this import.
 */
export function retainedTextBudgetFromSettings() {
  return readSettingBootValue('editor.retainedTextBudget')
}
