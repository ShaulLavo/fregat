import type { DocumentKey, TabId } from '@/lib/documents/utils/types'
import { createContext } from 'react'

import type { EditorStatusBarSource } from '@/features/editor/state/status-bar-source'
import type { DocumentSessionChange, EditorScrollPosition } from '@singapore-editor/core'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerReferencesResult,
  OnApplyWorkspaceEdit,
} from '@singapore-editor/lsp-plugin'

export type EditorSurfaceActions = {
  readonly applyWorkspaceEdit: OnApplyWorkspaceEdit
  readonly closeReferences: () => void
  /** Null when the tab is not a conflict editor over a file that still exists on disk. */
  readonly compareMergeConflict: (() => void) | null
  readonly openDefinition: (target: LanguageServerDefinitionTarget) => void | boolean
  readonly openReferences: (result: LanguageServerReferencesResult) => void | boolean
  readonly previewReference: (target: LanguageServerDefinitionTarget) => void
  readonly handleTextChange: (tabId: TabId, key: DocumentKey, change: DocumentSessionChange) => void
  readonly setScrollPosition: (scrollPosition: EditorScrollPosition) => void
  readonly setStatusSource: (source: EditorStatusBarSource | null) => void
}

export const EditorSurfaceActionsContext = createContext<EditorSurfaceActions | null>(null)
