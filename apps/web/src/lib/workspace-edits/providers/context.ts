import { createContext } from 'react'
import type { WorkspaceTextChanges } from '@/lib/workspace-edits/utils/types'

export const WorkspaceTextChangesContext = createContext<WorkspaceTextChanges | null>(null)
