import { readSettingBootValue } from '@/features/settings/utils/boot-mirror'

/**
 * The retention budget, read at call time so a change applies at the next switch
 * or close rather than the next reload. Injected as a function so `apply-actions`
 * makes no `@/features/settings` import and a test can pin it without a Storage shim.
 */
export function retainedTextBudgetFromSettings() {
  return readSettingBootValue('editor.retainedTextBudget')
}
