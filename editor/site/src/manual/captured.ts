import activation from '../../.capture/activation/activate.js?raw'
import serialized from '../../.capture/documents.json?raw'

type CapturedPaint = {
  readonly paint: string
  readonly html: Readonly<Record<number, string>>
  readonly anchors: Readonly<Record<number, Readonly<Record<string, number>>>>
  readonly headings: readonly {
    readonly level: number
    readonly id: string
    readonly name: string
  }[]
  readonly description: string
  readonly height: number
  readonly rows: number
}
export type CapturedDocument = {
  readonly text: string
  readonly light: CapturedPaint
  readonly dark: CapturedPaint
}
const captures = JSON.parse(serialized) as {
  readonly documents: Record<string, CapturedDocument>
}
export const capturedDocument = (file: string): CapturedDocument => {
  const result = captures.documents[file]
  if (!result) throw new TypeError(`Missing editor capture for ${file}. Run the site build.`)
  return result
}
export const inlineJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export { activation }
export type ReaderDocument = {
  readonly text: string
  readonly light: { readonly paint: string }
  readonly dark: { readonly paint: string }
}
export const readerDocument = (capture: CapturedDocument): ReaderDocument => ({
  text: capture.text,
  light: { paint: capture.light.paint },
  dark: { paint: capture.dark.paint },
})
