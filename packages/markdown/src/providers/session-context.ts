import { createContext } from 'react'

import { createMarkdownSession, type MarkdownSessionFactory } from '../utils/session'

export const MarkdownSessionContext = createContext<MarkdownSessionFactory>(createMarkdownSession)
