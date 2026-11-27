import type { ActivationFocusDecision } from '@shaulavo/workbench-core'

const activationFocusByTabId = new Map<string, ActivationFocusDecision>()

/** Records the triggering input decision for a tab so async surface mounts honor it. */
export function recordTabActivationFocus(
  tabId: string,
  focus: ActivationFocusDecision | undefined,
): void {
  if (!focus) {
    activationFocusByTabId.delete(tabId)
    return
  }
  activationFocusByTabId.set(tabId, focus)
}

/** Returns false when the tab's latest activation explicitly opted out of automatic input focus. */
export function tabShouldAutoFocus(tabId: string | undefined): boolean {
  if (!tabId) return true
  return activationFocusByTabId.get(tabId)?.shouldFocusEditor ?? true
}
