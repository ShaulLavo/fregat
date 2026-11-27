import type { ActivationFocusDecision } from '@shaulavo/workbench-core'
import { useSyncExternalStore } from 'react'

type RecordedTabActivation = {
  readonly focus: ActivationFocusDecision
  readonly seq: number
}

const activationFocusByTabId = new Map<string, RecordedTabActivation>()
const listeners = new Set<() => void>()
let nextSeq = 0

function notifyListeners() {
  for (const listener of listeners) listener()
}

function subscribeTabActivationFocus(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Records the triggering input decision for a tab so async surface mounts honor it. */
export function recordTabActivationFocus(
  tabId: string,
  focus: ActivationFocusDecision | undefined,
): void {
  if (!focus) {
    if (activationFocusByTabId.delete(tabId)) notifyListeners()
    return
  }
  nextSeq += 1
  activationFocusByTabId.set(tabId, { focus, seq: nextSeq })
  notifyListeners()
}

/** Returns false when the tab's latest activation explicitly opted out of automatic input focus. */
export function tabShouldAutoFocus(tabId: string | undefined): boolean {
  if (!tabId) return true
  return activationFocusByTabId.get(tabId)?.focus.shouldFocusEditor ?? true
}

/** Subscribes to the tab's active recorded activation token so mounted surfaces consume repeat taps. */
export function useTabActivationSequence(tabId: string | undefined): number | undefined {
  return useSyncExternalStore(subscribeTabActivationFocus, () =>
    tabId ? activationFocusByTabId.get(tabId)?.seq : undefined,
  )
}
