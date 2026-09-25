import { createContext } from 'react'

/** What a rendered markdown file's links resolve against, and how one opens a workspace file. */
export const MarkdownPreviewContext = createContext<{
  readonly documentPath: string
  readonly rootPath: string
  readonly openFile: (path: string) => void
} | null>(null)
