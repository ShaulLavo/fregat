import { editorDocumentToken, type Address } from '@workspace/client-core/address/grammar'

import { contentForDocumentToken } from '@/features/address/utils/document-token'
import { isEditorTabDirty } from '@/features/workspace/utils/tab-dirty'
import { isPhoneShell, setPhoneTab, useShellStore } from '@/lib/shell/state/store'
import { tabsForPhoneOpen } from '@/lib/shell/utils/phone-tab'
import type { ApplicationRuntime } from '@/state/application-runtime'

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
  const opened = tabsForPhoneOpen(previous.tabs ?? [], token, ownTab(application, rootPath))
  return {
    address: { ...next, tabs: opened.tabs },
    claim: () => setPhoneTab(opened.own === null ? null : { rootPath, token: opened.own }),
  }
}

function ownTab(application: ApplicationRuntime, rootPath: string | null) {
  const tab = useShellStore.getState().phoneTab
  if (!tab || tab.rootPath !== rootPath) return null
  const parsed = contentForDocumentToken(rootPath, tab.token)
  if (parsed.kind !== 'content') return null
  const dirty = application.getSnapshot().editor.documentStore.getState().dirtyDocumentKeys
  // Unsaved edits keep the tab open, as typing pins a preview tab.
  return isEditorTabDirty(parsed.content, dirty) ? null : tab.token
}
