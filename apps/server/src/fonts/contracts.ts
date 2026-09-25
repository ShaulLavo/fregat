import * as v from 'valibot'

export const defaultPreviewText = 'The quick brown fox jumps 0123'
const fontNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const fontsourceIdPattern = /^[a-z0-9][a-z0-9-]{0,127}$/u

export const fontPreviewQuerySchema = v.object({
  ref: v.pipe(v.string(), v.minLength(3), v.maxLength(160)),
  text: v.optional(v.pipe(v.string(), v.maxLength(256))),
})

export const nerdFontParamsSchema = v.object({
  name: v.pipe(v.string(), v.regex(fontNamePattern)),
})

export const fontsourceStylesheetParamsSchema = v.object({
  id: v.pipe(v.string(), v.maxLength(132), v.regex(/^[a-z0-9][a-z0-9-]*\.css$/u)),
})

export const fontsourceFileParamsSchema = v.object({
  id: v.pipe(v.string(), v.regex(fontsourceIdPattern)),
  file: v.pipe(v.string(), v.maxLength(64)),
})

export function isValidFontName(name: string) {
  return fontNamePattern.test(name)
}

export const localStylesheetParamsSchema = v.object({
  id: v.pipe(v.string(), v.maxLength(80), v.endsWith('.css')),
})

export const localFileParamsSchema = v.object({
  id: v.pipe(v.string(), v.maxLength(64)),
  face: v.pipe(v.string(), v.regex(/^\d{1,3}$/u)),
})
