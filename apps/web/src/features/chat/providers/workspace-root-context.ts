import { createContext } from 'react'

export type ChatWorkspaceRoot = { readonly canonicalPath: string; readonly path: string }

export const ChatWorkspaceRootContext = createContext<ChatWorkspaceRoot | null>(null)
