import { createContext } from 'react'

import type { MermaidRenderer } from '@/features/chat/state/mermaid'

/** Non-null only once a message has settled and the diagram library is in. */
export const MarkdownDiagramContext = createContext<MermaidRenderer | null>(null)
