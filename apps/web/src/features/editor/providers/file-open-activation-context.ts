import { createContext } from 'react'

import type { EditorActivation } from '@/features/editor/state/apply-actions'

export const EditorActivationContext = createContext<EditorActivation | null>(null)
