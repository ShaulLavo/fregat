import {
  createTabId,
  documentKey,
  fileDocument,
  fileResource,
  settingsJsonDocument,
} from '@/lib/documents/utils/identity'
import type {
  DocumentRef,
  EditorTabRecord,
  FilesystemPath,
  SettingsSelection,
  StandaloneDocumentRef,
  TabContent,
} from '@/lib/documents/utils/types'

const SETTINGS_TAB: TabContent = { kind: 'settings' }
const SETTINGS_MEMBERS = [settingsJsonDocument('user'), settingsJsonDocument('workspace')] as const

export function documentTab(document: StandaloneDocumentRef): TabContent {
  return { kind: 'document', document }
}

export function settingsTab(): TabContent {
  return SETTINGS_TAB
}

export function createEditorTabRecord(content: TabContent): EditorTabRecord {
  return { id: createTabId(), content }
}

export function tabDocuments(content: TabContent): readonly DocumentRef[] {
  switch (content.kind) {
    case 'document':
      return [content.document]
    case 'settings':
      return SETTINGS_MEMBERS
    default: {
      const exhaustive: never = content
      return exhaustive
    }
  }
}

export function activeTabDocument(
  content: TabContent,
  selection: SettingsSelection,
): DocumentRef | null {
  if (content.kind === 'document') return content.document
  if (selection.kind === 'form') return null
  return SETTINGS_MEMBERS[selection.target === 'user' ? 0 : 1]
}

export function tabContentKey(content: TabContent): string {
  if (content.kind === 'settings') return 'settings-tab'
  return documentKey(content.document)
}

export function sameTabContent(left: TabContent, right: TabContent): boolean {
  return left === right || tabContentKey(left) === tabContentKey(right)
}

export function retainedTabDocuments(content: TabContent): readonly DocumentRef[] {
  if (content.kind === 'settings') return SETTINGS_MEMBERS
  const document = content.document
  if (document.kind !== 'compare-saved') return [document]
  return [document, fileDocument(document.file)]
}

export function rekeyTabFile(
  content: TabContent,
  from: FilesystemPath,
  to: FilesystemPath,
): TabContent {
  if (content.kind !== 'document') return content
  if (content.document.kind !== 'file' || content.document.resource.path !== from) return content
  return documentTab(fileDocument(fileResource(to)))
}
