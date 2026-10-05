import { createContext } from 'react'

import type { useOpenFileReference } from '@/features/chat/hooks/use-open-file-reference'
import type { MarkdownFileReference } from '@/features/chat/utils/markdown-file-links'

export type MarkdownFileLinkActions = {
  readonly openFileReference: (reference: MarkdownFileReference) => void
  readonly prepareFileReference: ReturnType<typeof useOpenFileReference>['prepareFileReference']
  /** Workspace root the transcript's relative paths resolve against. */
  readonly rootPath: string | null
}

export const MarkdownFileLinkContext = createContext<MarkdownFileLinkActions | null>(null)
