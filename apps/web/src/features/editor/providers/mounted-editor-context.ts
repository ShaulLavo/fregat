import { createContext } from 'react'

import type { MountedEditorRegistry } from '@/features/editor/state/mounted-editor-registry'

export const MountedEditorContext = createContext<MountedEditorRegistry | null>(null)
