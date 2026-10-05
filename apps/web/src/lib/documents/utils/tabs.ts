import { sameSnapshotTarget } from '@/lib/documents/utils/comparisons'
import {
  createTabId,
  documentKey,
  fileDocument,
  fileResource,
  sameDocument,
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
const SETTINGS_MEMBERS = [
  settingsJsonDocument('user'),
  settingsJsonDocument('workspace'),
  settingsJsonDocument('default'),
] as const

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
  return SETTINGS_MEMBERS.find((member) => member.target === selection.target) ?? null
}

export function tabContentKey(content: TabContent): string {
  if (content.kind === 'settings') return 'settings-tab'
  return documentKey(content.document)
}

export function sameTabContent(left: TabContent, right: TabContent): boolean {
  if (left === right) return true
  if (left.kind === 'settings' || right.kind === 'settings') return left.kind === right.kind
  return sameDocument(left.document, right.document)
}

export function retainedTabDocuments(content: TabContent): readonly DocumentRef[] {
  if (content.kind === 'settings') return SETTINGS_MEMBERS
  const document = content.document
  if (document.kind !== 'compare-saved' && document.kind !== 'history') return [document]
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

export function sameTabCapture(left: TabContent, right: TabContent): boolean {
  if (!sameTabContent(left, right)) return false
  if (left.kind !== 'document' || right.kind !== 'document') return true
  if (left.document.kind !== 'git-diff' || right.document.kind !== 'git-diff') return true
  if (left.document.source.kind !== 'snapshot' || right.document.source.kind !== 'snapshot')
    return true
  return sameSnapshotTarget(left.document.source.target, right.document.source.target)
}
