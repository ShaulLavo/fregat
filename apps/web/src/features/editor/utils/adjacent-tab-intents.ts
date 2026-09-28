import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { activeEditorGroup } from '@/lib/documents/utils/groups'
import type { EditorGroups } from '@/lib/documents/utils/group-types'
import type { TabContent } from '@/lib/documents/utils/types'
import type { FileOpenIntent } from '@/lib/file-open-intent/state/service'
import { previousOpenTabContent } from '@/features/editor/utils/tab-history'

type AdjacentTabState = {
  readonly editorHistory: readonly TabContent[]
  readonly openTabContents: readonly TabContent[]
  readonly selectedTabContent: TabContent | null
  readonly workbenchPanels: { readonly editorGroups: EditorGroups }
}

/** The files Next Editor, Previous Editor (both wrap) and the previous editor would open. */
export function adjacentTabIntents(state: AdjacentTabState): readonly FileOpenIntent[] {
  const group = activeEditorGroup(state.workbenchPanels.editorGroups)
  const index = group.tabs.findIndex((tab) => tab.id === group.selectedTabId)
  const count = group.tabs.length
  const intents: FileOpenIntent[] = []
  if (index >= 0 && count > 1) {
    for (const step of [1, -1]) {
      const tab = group.tabs[(index + step + count) % count]!
      const resource = tabFileResource(tab.content)
      if (resource) intents.push(adjacentIntent(resource.path, tab.id))
    }
  }
  const previous = tabFileResource(
    previousOpenTabContent(state.editorHistory, state.openTabContents, state.selectedTabContent),
  )
  if (previous) intents.push(adjacentIntent(previous.path))
  return intents
}

function adjacentIntent(path: FileOpenIntent['path'], tabId?: FileOpenIntent['tabId']) {
  return { path, source: 'tab', tabId, trigger: 'adjacent-tab' } satisfies FileOpenIntent
}
