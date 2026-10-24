import { createContext } from 'react'

import type { MarkdownSessionFactory } from '../utils/session'

/** A host may select its parser; unscoped Markdown keeps the remark default. */
export const MarkdownSessionContext = createContext<MarkdownSessionFactory | null>(null)
