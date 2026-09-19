import * as v from 'valibot'
import { BUNDLED_THEMES, themeDocumentSchema } from '@workspace/contracts'

export function themeDocument(id = 'my-bundle') {
  const base = BUNDLED_THEMES[0]!
  return v.parse(themeDocumentSchema, {
    schemaVersion: 1,
    id,
    name: 'My bundle',
    variants: {
      light: {
        ...base.variants.light,
        palette: 'sage',
        wallpaper: { enabled: false, source: { kind: 'desktop' } },
      },
      dark: {
        ...base.variants.dark,
        palette: 'graphite',
        wallpaper: { enabled: true, source: { kind: 'desktop' } },
      },
    },
  })
}
