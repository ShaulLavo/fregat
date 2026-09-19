import * as v from 'valibot'
import { themeDocumentSchema } from './bundle'
import { assetIdSchema } from './wallpaper'

export const THEME_ARCHIVE_LIMIT = 60 * 1024 * 1024
export const themeArchiveSchema = v.strictObject({
  format: v.literal('platform-theme'),
  version: v.literal(1),
  theme: themeDocumentSchema,
  palettes: v.pipe(v.array(v.unknown()), v.maxLength(2)),
  wallpapers: v.pipe(
    v.array(
      v.strictObject({
        id: assetIdSchema,
        name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
        base64: v.pipe(
          v.string(),
          v.maxLength(28 * 1024 * 1024),
          v.regex(/^[A-Za-z0-9+/]*={0,2}$/),
        ),
      }),
    ),
    v.maxLength(2),
  ),
  notices: v.pipe(v.array(v.pipe(v.string(), v.maxLength(10000))), v.maxLength(20)),
})
export type ThemeArchive = v.InferOutput<typeof themeArchiveSchema>
