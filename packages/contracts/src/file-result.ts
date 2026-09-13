export type TextEncodingLabel = 'utf8' | 'utf16le' | 'utf16be'

/**
 * Decode metadata describing how bytes on disk became `content`.
 *
 * Every `/fs/read` response carries all three. They are optional here because a `FileResult` is
 * also synthesized from text that never came off disk — a projected workspace edit, a conflict
 * resolution, a saved-buffer snapshot — and such a result has no decode to describe. Absent means
 * "this text came from an editor buffer", for which the defaults below are the truthful answer.
 */
export type TextDecodeMetadata = {
  /** Encoding the bytes were decoded as. Anything but `utf8` was transcoded on the way in. */
  encoding?: TextEncodingLabel
  /** `content` does not re-encode to the bytes on disk, so saving it would rewrite them. */
  lossy?: boolean
  /** A NUL in the first 512 bytes that is not UTF-16 shaped. A hint for the UI, not an error. */
  seemsBinary?: boolean
}

export type FileResult = TextDecodeMetadata & {
  path: string
  content: string
  mtimeMs: number
  size: number
  version: string
}

/** The decode metadata for text that came from an editor buffer rather than a read. */
export const decodedAsText = {
  encoding: 'utf8',
  lossy: false,
  seemsBinary: false,
} as const satisfies Required<TextDecodeMetadata>
