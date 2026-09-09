import { createContext } from 'react'

import type { EditorActivation } from '@/features/editor/state/commands'

export const EditorActivationContext = createContext<EditorActivation | null>(null)
