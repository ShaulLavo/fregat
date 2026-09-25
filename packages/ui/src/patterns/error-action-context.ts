import { createContext, type ReactNode } from 'react'

/** A failure as a primitive showed it, in plain text. */
export type ShownError = { readonly title: string; readonly message?: string }

/** The app's action beside every error state; `packages/ui` cannot import the app that owns it. */
export const ErrorActionContext = createContext<((error: ShownError) => ReactNode) | null>(null)
