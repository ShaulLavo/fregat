import { createContext, type RefObject } from 'react'

/** The settings form's one scroller, which a long list windows against instead of scrolling itself. */
export const SettingsScrollerContext = createContext<RefObject<HTMLDivElement | null> | null>(null)
