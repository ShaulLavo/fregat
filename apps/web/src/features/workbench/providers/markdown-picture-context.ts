import { createContext } from 'react'

/** True inside a `<picture>` whose sources load from the workspace, which needs a CORS request. */
export const MarkdownPictureContext = createContext(false)
