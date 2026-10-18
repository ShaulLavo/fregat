import { createContext } from 'react'

/**
 * Inside a `<picture>`, whether the source the browser takes loads from the workspace, which needs
 * a CORS request; `null` when no source applies, outside a picture, or the image's own `src` decides.
 */
export const MarkdownPictureContext = createContext<boolean | null>(null)
