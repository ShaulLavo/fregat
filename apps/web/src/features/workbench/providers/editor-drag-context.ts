import { createContext } from 'react'
import type { EditorDropPreview } from '@/features/workbench/utils/editor-drag'
import type { TabId } from '@/lib/documents/utils/types'

export type EditorDragState = {
  readonly tabId: TabId
  readonly preview: EditorDropPreview | null
  readonly copy: boolean
}

export const EditorDragContext = createContext<EditorDragState | null>(null)
