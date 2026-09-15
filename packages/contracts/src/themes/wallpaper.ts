import * as v from 'valibot'

export const assetIdSchema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/), v.brand('AssetId'))
export type AssetId = v.InferOutput<typeof assetIdSchema>
export const wallpaperSourceSchema = v.variant('kind', [
  v.object({ kind: v.literal('none') }),
  v.object({ kind: v.literal('desktop') }),
  v.object({ kind: v.literal('library'), asset: assetIdSchema }),
])
export type WallpaperSource = v.InferOutput<typeof wallpaperSourceSchema>
export const wallpaperSelectionSchema = v.object({
  light: wallpaperSourceSchema,
  dark: wallpaperSourceSchema,
})
export type WallpaperSelection = v.InferOutput<typeof wallpaperSelectionSchema>
const wallpaperProvenanceSchema = v.variant('kind', [
  v.object({ kind: v.literal('upload') }),
  v.object({ kind: v.literal('omarchy'), theme: v.string(), path: v.string() }),
])
export const wallpaperAssetSchema = v.object({
  id: assetIdSchema,
  name: v.string(),
  width: v.pipe(v.number(), v.integer(), v.minValue(1)),
  height: v.pipe(v.number(), v.integer(), v.minValue(1)),
  extension: v.picklist(['jpg', 'png', 'webp']),
  contentType: v.picklist(['image/jpeg', 'image/png', 'image/webp']),
  thumbnail: v.string(),
  provenance: v.array(wallpaperProvenanceSchema),
  redistribution: v.literal('unverified'),
  focalPoint: v.optional(
    v.object({
      x: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
      y: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
    }),
  ),
})
export type WallpaperAsset = v.InferOutput<typeof wallpaperAssetSchema>
export const wallpaperIndexSchema = v.array(wallpaperAssetSchema)
