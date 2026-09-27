import { editorDocumentToken, type Address } from '@workspace/client-core/address/grammar'

import { contentForDocumentToken } from '@/features/address/utils/document-token'
import { isEditorTabDirty } from '@/features/workspace/utils/tab-dirty'
import { isPhoneShell, setPhoneTab, useShellStore } from '@/lib/shell/state/store'
import { tabsForPhoneOpen, type PhoneTab } from '@/lib/shell/utils/phone-tab'
import type { ApplicationRuntime } from '@/state/application-runtime'

let stopWatchingEdits: (() => void) | null = null

/**
 * The phone has no tab strip, so a file it opens replaces the last one it opened. `claim` records
 * the new owner once the navigation applies; a superseded one leaves the old owner in place.
 */
export function withPhoneTab(
  application: ApplicationRuntime,
  previous: Address,
  next: Address,
  rootPath: string | null,
): { readonly address: Address; readonly claim: () => void } {
  const token = editorDocumentToken(next)
  if (!isPhoneShell() || token === null) return { address: next, claim: () => {} }
  const opened = tabsForPhoneOpen(previous.tabs ?? [], token, ownTab(rootPath))
  return {
    address: { ...next, tabs: opened.tabs },
    claim: () =>
      claimPhoneTab(application, opened.own === null ? null : { rootPath, token: opened.own }),
  }
}

function ownTab(rootPath: string | null) {
  const tab = useShellStore.getState().phoneTab
  return tab && tab.rootPath === rootPath ? tab.token : null
}

/** The first edit pins the tab, as typing pins a preview tab: saving it later never frees it. */
function claimPhoneTab(application: ApplicationRuntime, tab: PhoneTab | null) {
  const current = useShellStore.getState().phoneTab
  if (tab && current?.token === tab.token && current.rootPath === tab.rootPath) return
  stopWatchingEdits?.()
  stopWatchingEdits = null
  setPhoneTab(tab)
  if (tab === null) return
  const parsed = contentForDocumentToken(tab.rootPath, tab.token)
  if (parsed.kind !== 'content') return
  const stop = application.getSnapshot().editor.documentStore.subscribe(
    (state) => state.dirtyDocumentKeys,
    (dirty) => {
      if (!isEditorTabDirty(parsed.content, dirty)) return
      if (useShellStore.getState().phoneTab === tab) setPhoneTab(null)
      stop()
    },
  )
  stopWatchingEdits = stop
}
