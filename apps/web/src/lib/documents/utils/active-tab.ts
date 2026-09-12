import type { EditorTabRecord, TabId } from '@/lib/documents/utils/types'

export function activeEditorTabId(
  tabs: readonly Pick<EditorTabRecord, 'id'>[],
  currentId: TabId | null,
  { fallbackToFirstWhenUnset }: { readonly fallbackToFirstWhenUnset: boolean },
): TabId | null {
  if (currentId === null && !fallbackToFirstWhenUnset) return null
  if (tabs.some((tab) => tab.id === currentId)) return currentId

  return tabs[0]?.id ?? null
}
