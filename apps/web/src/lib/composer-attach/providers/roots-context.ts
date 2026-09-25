import { createContext } from 'react'

/** Roots besides its own `rootPath` whose captures a composer takes: the session's worktree and workspace. */
export const ComposerRootsContext = createContext<readonly string[]>([])
